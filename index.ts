import { ActionCheckSource, AdminForthPlugin, AdminForthSortDirections, Filters, IAdminForthDataSourceConnectorBase, IHttpServer } from "adminforth";
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
  }
    
  createApprovalRequest = async (
    {resource, action, data, user, oldRecord, updates, extra, record}:
    {resource: AdminForthResource, action: AllowedForReviewActionsEnum, data: Object, user: AdminUser, record?: Object, oldRecord?: Object, updates?: Object, extra?: HttpExtra}
  ) => {
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
    const diffResource = this.adminforth.config.resources.find((r) => r.resourceId === this.diffResource.resourceId);
    await this.adminforth.createResourceRecord({ resource: diffResource, record: diffRecord, adminUser: user});
    return { ok: true, error: null };
  }

  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    // optional method where you can safely check field types after database discovery was performed
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
    extra.adminforth_plugin_crud_approve = {
      callingFromApprovalPlugin: true
    }
    for (const hook of hooks) {
      const resp = await hook({ 
        resource, 
        record, 
        adminUser,
        recordId,
        adminforth: this.adminforth,
        extra,
        updates,
        oldRecord,
      });
      if (!resp || (typeof resp.ok !== 'boolean' && (!resp.error && !resp.newRecordId))) {
        throw new Error(
          `Invalid return value from beforeSave hook. Expected: { ok: boolean, error?: string | null, newRecordId?: any }.\n` +
          `Note: Return { ok: false, error: null, newRecordId } to stop creation and redirect to an existing record.`
        );
      }
      if (resp.ok === false && !resp.error) {
        const { error, ok, newRecordId } = resp;
        return {
          error: error ?? 'Operation aborted by hook',
          newRecordId: newRecordId
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
        record,
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

  verifyAuth = async (cookies: Array<{key: string, value: string}>) => {
    let authCookie;
    for (const i in cookies) {
      if (cookies[i].key === `adminforth_${this.adminforth.config.customization.brandNameSlug}_jwt`) {
        authCookie = cookies[i].value;
      }
    }
    const authRes = await this.adminforth.auth.verify(authCookie, 'auth', true);
    if ('error' in authRes) {
      return { error: authRes.error, authRes: null };
    }
    return { error: null, authRes: authRes };
  }

  createRecord = async (resource: AdminForthResource, diffData: any, adminUser: AdminUser) => {
    const connector = this.adminforth.connectors[resource.dataSource];
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

  setupEndpoints(server: IHttpServer): void {
    server.endpoint({
      method: 'POST',
      path: `/plugin/crud-approve/update-status`,
      noAuth: true,
      handler: async ({ body, response, cookies }) => {
        const authRes = await this.verifyAuth(cookies);
        if (authRes.error) {
          response.status = 403;
          return { error: authRes.error };
        }
        const adminUser = authRes.authRes;

        const { resourceId, diffId, recordId, action, approved, code } = body;
        const diffRecord = await this.adminforth.resource(this.diffResource.resourceId).get(
          Filters.EQ(this.options.resourceColumns.idColumnName, diffId),
        )
        if (!diffRecord) {
          response.status = 404;
          return { error: 'Diff record not found' };
        }
        
        if (diffRecord[this.options.resourceColumns.statusColumnName] !== ApprovalStatusEnum.pending) {
          response.status = 400;
          return { error: 'Diff record is not pending' };
        }
        
        if (approved === true) {
          const resource = this.adminforth.config.resources.find(
            (res) => res.resourceId == diffRecord[this.options.resourceColumns.resourceIdColumnName]
          );
          const diffData = diffRecord[this.options.resourceColumns.dataColumnName];
          const extra = diffRecord[this.options.resourceColumns.extraColumnName] || {};
          extra.body = body;
          let oldRecord = undefined;
          if (action !== AllowedActionsEnum.create) {
            oldRecord = await this.adminforth.connectors[resource.dataSource].getRecordByPrimaryKey(
              resource, diffRecord[this.options.resourceColumns.recordIdColumnName]
            );
          }
          const beforeSaveResp = await this.callBeforeSaveHooks(
            resource, action as AllowedActionsEnum, diffData['newRecord'], 
            adminUser, diffRecord[this.options.resourceColumns.recordIdColumnName],
            diffData['newRecord'], oldRecord, this.adminforth, extra
          );
          if (beforeSaveResp.error) {
            if (beforeSaveResp.error === 'Operation aborted by hook') {
              return beforeSaveResp;
            }
            response.status = 500;
            return { error: `Failed to apply approved changes: ${beforeSaveResp.error}` };
          }
          
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
            response.status = 500;
            console.error('Error applying approved changes:', recordUpdateResult);
            return { error: `Failed to apply approved changes: ${recordUpdateResult.error}` };
          }

          let afterSaveResp;
          if (action === AllowedActionsEnum.create) {
            const newRecord = recordUpdateResult.createdRecord;
            afterSaveResp = await this.callAfterSaveHooks(
              resource, action as AllowedActionsEnum, newRecord, adminUser, 
              diffRecord[this.options.resourceColumns.recordIdColumnName],
              newRecord, {}, this.adminforth, { body }
            );
          } else if (action === AllowedActionsEnum.edit) {
            const newRecord = diffData['newRecord'];
            const oldRecord = await this.adminforth.connectors[resource.dataSource].getRecordByPrimaryKey(
              resource, diffRecord[this.options.resourceColumns.recordIdColumnName]
            );
            afterSaveResp = await this.callAfterSaveHooks(
              resource, action as AllowedActionsEnum, newRecord, adminUser, 
              recordId, newRecord, oldRecord, this.adminforth, { body }
            );
          } else if (action === AllowedActionsEnum.delete) {
            const newRecord = diffData['newRecord'];
            afterSaveResp = await this.callAfterSaveHooks(
              resource, action as AllowedActionsEnum, newRecord, adminUser, 
              diffRecord[this.options.resourceColumns.recordIdColumnName],
              {}, diffData['oldRecord'], this.adminforth, { body }
            );
          }

          if (afterSaveResp?.error) {
            response.status = 500;
            return { error: `Failed to apply approved changes: ${afterSaveResp.error}` };
          }
        }
        const r = await this.adminforth.updateResourceRecord({
          resource: this.diffResource, recordId: diffId,
          adminUser: adminUser, oldRecord: diffRecord,
          updates: {
            [this.options.resourceColumns.statusColumnName]: approved ? ApprovalStatusEnum.approved : ApprovalStatusEnum.rejected,
            [this.options.resourceColumns.responserIdColumnName]: authRes.authRes.pk,
          },
          extra: {
            adminforth_plugin_crud_approve: {
              callingFromApprovalPlugin: true
            }
          }
        });
        if (r.error) {
          response.status = 500;
          return { error: `Failed to update diff record status: ${r.error}` };
        }
        return { ok: true };
      }
    })
  }
}