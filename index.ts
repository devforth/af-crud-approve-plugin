import { ActionCheckSource, AdminForthPlugin, AdminForthSortDirections, Filters, IAdminForthDataSourceConnectorBase, IHttpServer, suggestIfTypo } from "adminforth";
import { IAdminForth, AdminForthDataTypes, AdminForthResource, AllowedActionsEnum, HttpExtra, AdminUser } from "adminforth";
import { AllowedForReviewActionsEnum, ApprovalStatusEnum, type PluginOptions } from './types.js';

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { randomUUID } from "crypto";
dayjs.extend(utc);


export default class CRUDApprovePlugin extends AdminForthPlugin {
  options: PluginOptions;
  adminforth: IAdminForth;
  diffResource: AdminForthResource;

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
  }

  async modifyResourceConfig(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    // simply modify resourceConfig or adminforth.config. You can get access to plugin options via this.options;
    super.modifyResourceConfig(adminforth, resourceConfig);
    this.adminforth = adminforth;

    this.diffResource = this.resourceConfig;
    let diffColumn = resourceConfig.columns.find((c) => c.name === this.options.resourceColumns.dataColumnName); 
    if (!diffColumn) {
      throw new Error(`Column ${this.options.resourceColumns.dataColumnName} not found in ${resourceConfig.label}`)
    }
    if (diffColumn.type !== AdminForthDataTypes.JSON) {
      // throw new Error(`Column ${this.options.resourceColumns.dataColumnName} must be of type 'json'`)
    }

    diffColumn.components = {
      show: { 
        file: this.componentPath('ShowPageDiffView.vue'),
        meta: {
          ...this.options, 
          pluginInstanceId: this.pluginInstanceId
        }
      },
      list: {
        file: this.componentPath('ListPageDiffView.vue'),
        meta: {
          ...this.options, 
          pluginInstanceId: this.pluginInstanceId
        }
      }
    }
    resourceConfig.options.defaultSort = {
      columnName: this.options.resourceColumns.createdAtColumnName,
      direction: AdminForthSortDirections.desc
    }
    const bulkOnly = { list: false, listThreeDotsMenu: false, showButton: false, showThreeDotsMenu: false, bulkButton: true };
    resourceConfig.options.actions.push(
      {
        id: 'crud_approve_bulk_approve',
        name: 'Approve',
        icon: 'lucide:check',
        bulkConfirmationMessage: 'Approve the selected requests? Their changes are applied right away.',
        showIn: bulkOnly,
        bulkHandler: ({ recordIds, adminUser, extra }) => this.bulkUpdateStatus(recordIds, true, adminUser, extra?.cookies),
      },
      {
        id: 'crud_approve_bulk_reject',
        name: 'Reject',
        icon: 'lucide:x',
        bulkConfirmationMessage: 'Reject the selected requests?',
        bulkDangerous: true,
        showIn: bulkOnly,
        bulkHandler: ({ recordIds, adminUser, extra }) => this.bulkUpdateStatus(recordIds, false, adminUser, extra?.cookies),
      },
    );
  }
    
  createApprovalRequest = async (
    {resource, action, data, user, oldRecord, updates, extra, record}:
    {resource: AdminForthResource, action: AllowedForReviewActionsEnum, data: Object, user: AdminUser, record?: Object, oldRecord?: Object, updates?: Object, extra?: HttpExtra}
  ) => {
    //@ts-ignore
    if (extra && extra.adminforth_plugin_crud_approve && extra.adminforth_plugin_crud_approve.callingFromApprovalPlugin) {
      return { ok: true, error: 'Approval request creation aborted to avoid infinite loop' };
    }
    
    const recordIdFieldName = resource.columns.find((c) => c.primaryKey === true)?.name;
    const recordId = data?.[recordIdFieldName] || oldRecord?.[recordIdFieldName];

    let newRecord = {};
    const connector = this.adminforth.connectors[resource.dataSource];
    if (action === AllowedForReviewActionsEnum.create) {
      oldRecord = {};
      newRecord = updates || record;
    } else if (action === AllowedForReviewActionsEnum.edit) {
      newRecord = await connector.getRecordByPrimaryKey(resource, recordId);
      for (const key in updates) { 
        newRecord[key] = updates[key];
      }
    } else if (action === AllowedForReviewActionsEnum.delete) {
      oldRecord = await connector.getRecordByPrimaryKey(resource, recordId);
    }

    const checks = await Promise.all(
      resource.columns.map(async (c) => {
        if (typeof c.backendOnly === "function") {
          const result = await c.backendOnly({
            adminUser: user,
            resource,
            meta: {},
            source: ActionCheckSource.ShowRequest,
            adminforth: this.adminforth,
          });
          return { col: c, result };
        }
        return { col: c, result: c.backendOnly ?? false };
      })
    );

    const backendOnlyColumns = checks
      .filter(({ result }) => result === true)
      .map(({ col }) => col);
    
    backendOnlyColumns.forEach((c) => {
      if (JSON.stringify(oldRecord[c.name]) != JSON.stringify(newRecord[c.name])) {
        if (action !== AllowedForReviewActionsEnum.delete) {
          newRecord[c.name] = '<hidden value after>'
        }
        if (action !== AllowedForReviewActionsEnum.create) {
          oldRecord[c.name] = '<hidden value before>'
        }
      } else {
        delete oldRecord[c.name];
        delete newRecord[c.name];
      }
    });

    if (action === AllowedForReviewActionsEnum.edit) {
      for (const key in oldRecord) {
        if (JSON.stringify(oldRecord[key]) === JSON.stringify(newRecord[key])) {
          delete oldRecord[key];
          delete newRecord[key];
        }
      }
    }

    const createdAt = dayjs.utc().format();
    const diffRecord = {
      [this.options.resourceColumns.idColumnName]: randomUUID(),
      [this.options.resourceColumns.resourceIdColumnName]: resource.resourceId,
      [this.options.resourceColumns.actionColumnName]: action,
      [this.options.resourceColumns.statusColumnName]: ApprovalStatusEnum.pending,
      [this.options.resourceColumns.dataColumnName]: { 'oldRecord': oldRecord, 'newRecord': newRecord },
      [this.options.resourceColumns.userIdColumnName]: user.pk,
      [this.options.resourceColumns.recordIdColumnName]: recordId,
      [this.options.resourceColumns.createdAtColumnName]: createdAt,
      [this.options.resourceColumns.extraColumnName]: extra || {},
    }
    const { error } = await this.adminforth.resource(this.diffResource.resourceId)
      .asSystem({ adminUser: user })
      .create(diffRecord);
    if (error) {
      return { ok: false, error };
    }
    return { ok: true, error: null };
  }

  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    // a typo in diffTable would silently change nothing, so name it at startup
    for (const [resourceId, { fieldsOrder = [] }] of Object.entries(this.options.diffTable ?? {})) {
      const resource = adminforth.config.resources.find((res) => res.resourceId === resourceId);
      if (!resource) {
        const similar = suggestIfTypo(adminforth.config.resources.map((res) => res.resourceId), resourceId);
        throw new Error(`CRUDApprovePlugin diffTable: resource "${resourceId}" not found.${similar ? ` Did you mean "${similar}"?` : ''}`);
      }
      const columnNames = resource.columns.map((column) => column.name);
      // keys inside JSON ("reward.type") are unknown before requests come, only the column part is checked
      for (const name of fieldsOrder.map((entry) => entry.split('.')[0]).filter((name) => !columnNames.includes(name))) {
        const similar = suggestIfTypo(columnNames, name);
        throw new Error(`CRUDApprovePlugin diffTable.${resourceId}.fieldsOrder: column "${name}" not found.${similar ? ` Did you mean "${similar}"?` : ''}`);
      }
    }
  }

  instanceUniqueRepresentation(pluginOptions: any) : string {
    // optional method to return unique string representation of plugin instance. 
    // Needed if plugin can have multiple instances on one resource 
    return `single`;
  }

  callBeforeSaveHooks = async (
    // resource: AdminForthResource, action: AllowedActionsEnum, record: any, 
    // adminUser: AdminUser, recordId?: any, extra?: HttpExtra
    resource: AdminForthResource, action: AllowedActionsEnum, record: any,
    adminUser: AdminUser, recordId: any, updates: any, oldRecord: any,
    adminforth: IAdminForth, extra?: any
  ) => {
    let hooks = [];
    if (action === AllowedActionsEnum.create) {
      hooks = resource.hooks.create.beforeSave;
    } else if (action === AllowedActionsEnum.edit) {
      hooks = resource.hooks.edit.beforeSave;
    } else if (action === AllowedActionsEnum.delete) {
      hooks = resource.hooks.delete.beforeSave;
    }

    if (extra === undefined) {
      extra = {};
    }
    //@ts-ignore
    extra.adminforth_plugin_crud_approve = {
      //@ts-ignore
      callingFromApprovalPlugin: true
      //@ts-ignore
    }
    for (const hook of hooks) {
      const resp = await hook({
        resource,
        // edit hooks get the changed fields only in updates, like in core
        ...(action === AllowedActionsEnum.edit ? {} : { record }),
        adminUser,
        recordId,
        adminforth: this.adminforth,
        extra,
        updates,
        oldRecord,
      });
      if (!resp || (typeof resp.ok !== 'boolean' && (!resp.error && !resp.redirectToRecordId))) {
        throw new Error(
          `Invalid return value from beforeSave hook. Expected: { ok: boolean, error?: string | null, redirectToRecordId?: any }.\n` +
          `Note: Return { ok: false, error: null, redirectToRecordId } to stop creation and redirect to an existing record.`
        );
      }
      if (resp.ok === false && !resp.error) {
        const { error, redirectToRecordId } = resp;
        return {
          error: error ?? 'Operation aborted by hook',
          redirectToRecordId,
        };
      }
      if (resp.error) {
        return { error: resp.error };
      }
    }

    return { ok: true, error: null };
  }

  callAfterSaveHooks = async (
    // resource: AdminForthResource, action: AllowedActionsEnum, record: any, 
    // adminUser: AdminUser, recordId: any, extra?: HttpExtra

    resource: AdminForthResource,
    action: AllowedActionsEnum,
    record: any,
    adminUser: AdminUser,
    recordId: any,
    updates: any,
    oldRecord: any,
    adminforth: IAdminForth,
    extra?: HttpExtra
  ) => {
    let hooks = [];
    if (action === AllowedActionsEnum.create) {
      hooks = resource.hooks.create.afterSave;
    } else if (action === AllowedActionsEnum.edit) {
      hooks = resource.hooks.edit.afterSave;
    } else if (action === AllowedActionsEnum.delete) {
      hooks = resource.hooks.delete.afterSave;
    }

    for (const hook of hooks) {
      const resp = await hook({
        resource,
        ...(action === AllowedActionsEnum.edit ? {} : { record }),
        adminUser,
        recordId,
        adminforth: this.adminforth,
        extra,
        updates,
        oldRecord,
      });
      if (!resp || (!resp.ok && !resp.error)) {
        throw new Error(`Hook afterSave must return object with {ok: true} or { error: 'Error' } `);
      }

      if (resp.error) {
        return { error: resp.error };
      }
    }
  }
 
  createRecord = async (resource: AdminForthResource, diffData: any, adminUser: AdminUser) => {
    const connector = this.adminforth.connectors[resource.dataSource];
    //@ts-ignore
    const err = this.adminforth.validateRecordValues(resource, diffData['newRecord'], 'create');
    if (err) {
      return { ok: false, error: err, createdRecord: null };
    }

    // remove virtual columns from record
    for (const column of resource.columns.filter((col) => col.virtual)) {
      if (diffData['newRecord'][column.name]) {
        delete diffData['newRecord'][column.name];
      }
    }
    return await connector.createRecord({ resource, record: diffData['newRecord'], adminUser });
  }

  editRecord = async (resource: AdminForthResource, diffData: any, targetRecordId: any, connector: IAdminForthDataSourceConnectorBase) => {
    let oldRecord;
    const dataToUse = diffData['newRecord'];
    //@ts-ignore
    const err = this.adminforth.validateRecordValues(resource, dataToUse, 'edit', targetRecordId);
    if (err) {
      return { error: err };
    }
    // remove editReadonly columns from record
    oldRecord = await connector.getRecordByPrimaryKey(resource, targetRecordId);
    for (const column of resource.columns.filter((col) => col.editReadonly)) {
      if (column.name in dataToUse)
        delete dataToUse[column.name];
    }
    const newValues = {};
    for (const recordField in dataToUse) {
      if (dataToUse[recordField] !== oldRecord[recordField]) {
        // leave only changed fields to reduce data transfer/modifications in db
        const column = resource.columns.find((col) => col.name === recordField);
        if (!column || !column.virtual) {
          // exclude virtual columns
          newValues[recordField] = dataToUse[recordField];
        }
      }
    } 

    if (Object.keys(newValues).length > 0) {
      const { error } = await connector.updateRecord({ resource, recordId: targetRecordId, newValues });
      if ( error ) {
        return { ok: false, error };
      }
    }
    return { ok: true, error: null };
  }

  deleteRecord = async (resource: AdminForthResource, targetRecordId: any, connector: IAdminForthDataSourceConnectorBase) => {
    return await connector.deleteRecord({ resource, recordId: targetRecordId });
  }

  updateStatus = async (
    { diffId, approved, adminUser, body, cookies }:
    { diffId: string, approved: boolean, adminUser: AdminUser, body: any, cookies: any }
  ): Promise<{ ok?: boolean, error?: string, status?: number }> => {
    const diffRecord = await this.adminforth.resource(this.diffResource.resourceId).get(
      Filters.EQ(this.options.resourceColumns.idColumnName, diffId),
    )
    if (!diffRecord) {
      return { status: 404, error: 'Diff record not found' };
    }

    // the show permission of the approval resource is the approval permission, meta.record lets it
    // depend on the request being reviewed, and the row scope of the approval resource applies too
    try {
      const visibleDiffRecord = await this.adminforth.resource(this.diffResource.resourceId)
        .asUser(adminUser, { meta: { requestBody: body, pk: diffId, record: diffRecord } })
        .get(Filters.EQ(this.options.resourceColumns.idColumnName, diffId));
      if (!visibleDiffRecord) {
        return { status: 404, error: 'Diff record not found' };
      }
    } catch (e) {
      return { status: 403, error: (e as Error).message };
    }

    if (diffRecord[this.options.resourceColumns.statusColumnName] !== ApprovalStatusEnum.pending) {
      return { status: 400, error: 'Diff record is not pending' };
    }

    const action = diffRecord[this.options.resourceColumns.actionColumnName];
    const recordId = diffRecord[this.options.resourceColumns.recordIdColumnName];
    const targetResource = this.adminforth.config.resources.find(
      (res) => res.resourceId == diffRecord[this.options.resourceColumns.resourceIdColumnName]
    );

    // separation of duties: author of the request is not a valid reviewer for it
    const requesterId = diffRecord[this.options.resourceColumns.userIdColumnName];
    if (!this.options.allowSelfApproval
        && requesterId !== undefined && requesterId !== null
        && `${requesterId}` === `${adminUser.pk}`) {
      return { status: 403, error: 'You can not approve or reject your own change request' };
    }

    let beforeSaveResp;
    if (approved === true) {
      if (!targetResource) {
        return {
          status: 404,
          error: `Resource ${diffRecord[this.options.resourceColumns.resourceIdColumnName]} not found`
        };
      }
      const resource = targetResource;
      const diffData = diffRecord[this.options.resourceColumns.dataColumnName];
      const extra = diffRecord[this.options.resourceColumns.extraColumnName] || {};
      extra.body = body;
      extra.cookies = cookies;
      let oldRecord = undefined;
      if (action !== AllowedActionsEnum.create) {
        oldRecord = await this.adminforth.connectors[resource.dataSource].getRecordByPrimaryKey(
          resource, diffRecord[this.options.resourceColumns.recordIdColumnName]
        );
      }
      beforeSaveResp = await this.callBeforeSaveHooks(
        resource, action as AllowedActionsEnum, diffData['newRecord'], 
        adminUser, diffRecord[this.options.resourceColumns.recordIdColumnName],
        diffData['newRecord'], oldRecord, this.adminforth, extra
      );
      if (beforeSaveResp.error && beforeSaveResp.error !== 'Operation aborted by hook') {
        return { status: 500, error: `Failed to apply approved changes: ${beforeSaveResp.error}` };
      }
      

      if (beforeSaveResp.error !== 'Operation aborted by hook') {
        let recordUpdateResult;
        const connector = this.adminforth.connectors[resource.dataSource];
        if (action === AllowedActionsEnum.create) {
          recordUpdateResult = await this.createRecord(resource, diffData, adminUser);
        } else if (action === AllowedActionsEnum.edit) {
          recordUpdateResult = await this.editRecord(
            resource, diffData, diffRecord[this.options.resourceColumns.recordIdColumnName], connector
          );
        } else if (action === AllowedActionsEnum.delete) {
          recordUpdateResult = await this.deleteRecord(
            resource, diffRecord[this.options.resourceColumns.recordIdColumnName], connector
          );
        }
        if (recordUpdateResult?.error) {
          console.error('Error applying approved changes:', recordUpdateResult);
          return { status: 500, error: `Failed to apply approved changes: ${recordUpdateResult.error}` };
        }

        let afterSaveResp;
        if (action === AllowedActionsEnum.create) {
          const newRecord = recordUpdateResult.createdRecord;
          afterSaveResp = await this.callAfterSaveHooks(
            resource, action as AllowedActionsEnum, newRecord, adminUser, 
            diffRecord[this.options.resourceColumns.recordIdColumnName],
            //@ts-ignore
            newRecord, {}, this.adminforth, { body }
          );
        } else if (action === AllowedActionsEnum.edit) {
          const newRecord = diffData['newRecord'];
          const oldRecord = await this.adminforth.connectors[resource.dataSource].getRecordByPrimaryKey(
            resource, diffRecord[this.options.resourceColumns.recordIdColumnName]
          );
          afterSaveResp = await this.callAfterSaveHooks(
            resource, action as AllowedActionsEnum, newRecord, adminUser, 
            //@ts-ignore
            recordId, newRecord, oldRecord, this.adminforth, { body }
          );
        } else if (action === AllowedActionsEnum.delete) {
          const newRecord = diffData['newRecord'];
          afterSaveResp = await this.callAfterSaveHooks(
            resource, action as AllowedActionsEnum, newRecord, adminUser, 
            diffRecord[this.options.resourceColumns.recordIdColumnName],
            //@ts-ignore
            {}, diffData['oldRecord'], this.adminforth, { body }
          );
        }

        if (afterSaveResp?.error) {
          return { status: 500, error: `Failed to apply approved changes: ${afterSaveResp.error}` };
        }
      }
    }
    // the approval resource is not editable for users, the status is plugin bookkeeping
    const r = await this.adminforth.resource(this.diffResource.resourceId)
      .asSystem({
        adminUser,
        oldRecord: diffRecord,
        //@ts-ignore
        extra: { adminforth_plugin_crud_approve: { callingFromApprovalPlugin: true } },
      })
      .update(diffId, {
        [this.options.resourceColumns.statusColumnName]: approved ? ApprovalStatusEnum.approved : ApprovalStatusEnum.rejected,
        [this.options.resourceColumns.responserIdColumnName]: adminUser.pk,
      });
    if (r.error) {
      return { status: 500, error: `Failed to update diff record status: ${r.error}` };
    }
    if (beforeSaveResp?.error === 'Operation aborted by hook') {
      return beforeSaveResp;
    }
    return { ok: true };
  }

  // one by one: every request runs the hooks of its own resource, a failed one does not stop the rest
  bulkUpdateStatus = async (diffIds: (string | number)[], approved: boolean, adminUser: AdminUser, cookies: any) => {
    const errors = new Set<string>();
    let done = 0;
    for (const diffId of diffIds) {
      const { error } = await this.updateStatus({ diffId: `${diffId}`, approved, adminUser, body: { diffId, approved }, cookies });
      if (error && error !== 'Operation aborted by hook') {
        errors.add(error);
      } else {
        done++;
      }
    }
    const verb = approved ? 'Approved' : 'Rejected';
    const failed = errors.size ? ` Not ${verb.toLowerCase()}: ${[...errors].join('; ')}` : '';
    // nothing changed: an error toast, the list stays; something changed: ok refreshes the list
    if (!done) {
      return { ok: false, error: `${verb} 0 of ${diffIds.length}.${failed}` };
    }
    return { ok: true, successMessage: `${verb} ${done} of ${diffIds.length}.${failed}` };
  }

  setupEndpoints(server: IHttpServer): void {
    server.endpoint({
      method: 'POST',
      path: `/plugin/crud-approve/update-status`,
      handler: async ({ body, response, cookies, adminUser }) => {
        const { status, ...result } = await this.updateStatus({ diffId: body.diffId, approved: body.approved, adminUser, body, cookies });
        if (status) {
          //@ts-ignore
          response.status = status;
        }
        return result;
      }
    })
  }
} 