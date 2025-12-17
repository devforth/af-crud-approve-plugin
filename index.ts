import { ActionCheckSource, AdminForthPlugin, AdminForthSortDirections, Filters, IAdminForthDataSourceConnectorBase, IHttpServer } from "adminforth";
import { IAdminForth, AdminForthDataTypes, AdminForthResource, AllowedActionsEnum, HttpExtra, AdminUser } from "adminforth";
import { ApprovalStatusEnum, type PluginOptions } from './types.js';
import TwoFactorsAuthPlugin from '@adminforth/two-factors-auth';

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { randomUUID } from "crypto";
dayjs.extend(utc);


export default class CRUDApprovePlugin extends AdminForthPlugin {
  options: PluginOptions;
  // make sure plugin is activated later than other plugins
  activationOrder: number = 9999999;
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

    const diffResourceData = adminforth.config.resources.find(r => r.resourceId === this.options.diffTableName);
    if (!diffResourceData) {
      throw new Error(`Diff table ${this.options.diffTableName} not found in resources`);
    }
    this.diffResource = diffResourceData;


    if (this.options.diffTableName === resourceConfig.resourceId) {
      let diffColumn = resourceConfig.columns.find((c) => c.name === this.options.resourceColumns.dataColumnName); 
      if (!diffColumn) {
        throw new Error(`Column ${this.options.resourceColumns.dataColumnName} not found in ${resourceConfig.label}`)
      }
      if (diffColumn.type !== AdminForthDataTypes.JSON) {
        throw new Error(`Column ${this.options.resourceColumns.dataColumnName} must be of type 'json'`)
      }
    
      diffColumn.showIn = {
        show: true,
        list: false,
        edit: false,
        create: false,
        filter: false,
      };
      diffColumn.components = {
        show: { 
          file: this.componentPath('DiffView.vue'),
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
    
    if (this.options.diffTableName === resourceConfig.resourceId) {
      return {ok: true};
    }

    resourceConfig.hooks.create.beforeSave.unshift(async ({ resource, record, adminUser, extra }) => {
      // intercept create action and create approval request instead
      const res = await this.createApprovalRequest(resource, AllowedActionsEnum.create, record, adminUser, null, extra);
      if (!res) {
        return {ok: true};
      }
      // prevent actual creation
      return {ok: false, error: 'Creation pending approval' };
    });

    resourceConfig.hooks.edit.beforeSave.unshift(async ({ resource, updates, adminUser, oldRecord, extra }) => {
      // intercept update action and create approval request instead
      const res = await this.createApprovalRequest(resource, AllowedActionsEnum.edit, updates, adminUser, oldRecord, extra);
      if (!res) {
        return {ok: true};
      }
      // prevent actual update
      return {ok: false, error: 'Update pending approval' };
    });

    resourceConfig.hooks.delete.beforeSave.unshift(async ({ resource, record, adminUser, extra }) => {
      // intercept delete action and create approval request instead
      const res = await this.createApprovalRequest(resource, AllowedActionsEnum.delete, record, adminUser, null, extra);
      if (!res) {
        return {ok: true};
      }
      // prevent actual deletion
      return {ok: false, error: 'Deletion pending approval' };
    });
  }

  createApprovalRequest = async (resource: AdminForthResource, action: AllowedActionsEnum | string, data: Object, user: AdminUser, oldRecord?: Object, updates?: Object, extra?: HttpExtra, calledFromInside?: boolean) => {
    if (this.options.diffTableName === resource.resourceId || calledFromInside === true) {
      return false;
    }

    if (this.options.shouldReview !== false) {
      let shouldReviewFunc: (resource: AdminForthResource, action: AllowedActionsEnum | string, data: Object, user: AdminUser, oldRecord?: Object, extra?: HttpExtra) => Promise<boolean>;
      if (typeof this.options.shouldReview === 'function') {
        shouldReviewFunc = this.options.shouldReview;
      } else {
        shouldReviewFunc = async () => true;
      }
      const shouldReview = await shouldReviewFunc(resource, action, data, user, oldRecord, extra);
      if (!shouldReview) {
        return false;
      }
    }
  
    const recordIdFieldName = resource.columns.find((c) => c.primaryKey === true)?.name;
    const recordId = data?.[recordIdFieldName] || oldRecord?.[recordIdFieldName];

    let newRecord = {};
    const connector = this.adminforth.connectors[resource.dataSource];
    if (action === AllowedActionsEnum.edit) {
      newRecord = await connector.getRecordByPrimaryKey(resource, recordId);
      for (const key in updates.body.record) {
        newRecord[key] = updates.body.record[key];
      }
    } else if (action === AllowedActionsEnum.create) {
      oldRecord = {};
      newRecord = updates.body.record;
    } else if (action === AllowedActionsEnum.delete) {
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
        if (action !== AllowedActionsEnum.delete) {
          newRecord[c.name] = '<hidden value after>'
        }
        if (action !== AllowedActionsEnum.create) {
          oldRecord[c.name] = '<hidden value before>'
        }
      } else {
        delete oldRecord[c.name];
        delete newRecord[c.name];
      }
    });

    if (action === AllowedActionsEnum.edit) {
      for (const key in oldRecord) {
        if (JSON.stringify(oldRecord[key]) === JSON.stringify(newRecord[key])) {
          delete oldRecord[key];
          delete newRecord[key];
        }
      }
    }

    const createdAt = dayjs.utc().format();
    const record = {
      [this.options.resourceColumns.idColumnName]: randomUUID(),
      [this.options.resourceColumns.resourceIdColumnName]: resource.resourceId,
      [this.options.resourceColumns.actionColumnName]: action,
      [this.options.resourceColumns.statusColumnName]: ApprovalStatusEnum.pending,
      [this.options.resourceColumns.dataColumnName]: { 'oldRecord': oldRecord, 'newRecord': newRecord },
      [this.options.resourceColumns.userIdColumnName]: user.pk,
      [this.options.resourceColumns.recordIdColumnName]: recordId,
      [this.options.resourceColumns.createdAtColumnName]: createdAt,
    }
    const diffResource = this.adminforth.config.resources.find((r) => r.resourceId === this.diffResource.resourceId);
    await this.adminforth.createResourceRecord({ resource: diffResource, record, adminUser: user});
    return true
  }

  /**
   * Create a custom action in the audit log resource
   * @param resourceId - The resourceId of the resource that the action is being performed on. Can be null if the action is not related to a specific resource.
   * @param recordId - The recordId of the record that the action is being performed on. Can be null if the action is not related to a specific record.
   * @param actionId - The id of the action being performed, can be random string
   * @param data - The data to be stored in the audit log
   * @param user - The adminUser user performing the action
   */
  logCustomAction = async (params: {
      resourceId: string | null, 
      recordId: string | null,
      actionId: string,
      oldData: Object | null,
      data: Object,
      user: AdminUser,
      headers?: Record<string, string>
  }) => {
      const { resourceId, recordId, actionId, oldData, data, user, headers } = params;

      // if type of params is not object, throw error
      if (typeof params !== 'object') {
        throw new Error('params must be an object, please check AdminFoirth AuditLog custom action documentation')
      }
    
    if (resourceId) {
      const resource = this.adminforth.config.resources.find((r) => r.resourceId === resourceId);
      if (!resource) {
        const similarResource = this.adminforth.config.resources.find((r) => r.resourceId.includes(resourceId));
        throw new Error(`Resource ${resourceId} not found. Did you mean ${similarResource.resourceId}?`)
      }
    }

    const record = {
      [this.options.resourceColumns.resourceIdColumnName]: resourceId,
      [this.options.resourceColumns.actionColumnName]: actionId,
      [this.options.resourceColumns.dataColumnName]: { 'oldRecord': oldData || {}, 'newRecord': data },
      [this.options.resourceColumns.userIdColumnName]: user.pk,
      [this.options.resourceColumns.recordIdColumnName]: recordId,
      [this.options.resourceColumns.createdAtColumnName]: dayjs.utc().format(),
    }
    const diffResource = this.adminforth.config.resources.find((r) => r.resourceId === this.diffResource.resourceId);
    await this.adminforth.createResourceRecord({ resource: diffResource, record, adminUser: user});
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
    adminforth: IAdminForth, extra?: HttpExtra
  ) => {
    let hooks = [];
    if (action === AllowedActionsEnum.create) {
      hooks = resource.hooks.create.beforeSave;
    } else if (action === AllowedActionsEnum.edit) {
      hooks = resource.hooks.edit.beforeSave;
    } else if (action === AllowedActionsEnum.delete) {
      hooks = resource.hooks.delete.beforeSave;
    }

    if (!hooks[0].toString().includes('this.createApprovalRequest')) {
      throw new Error(`CRUDApprovePlugin must be the first beforeSave hook on resource ${resource.label} for action ${action}`);
    }
    const remainingHooks = hooks.slice(1);
    console.log('remainingHooks', remainingHooks);
    for (const hook of remainingHooks) {
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
        throw new Error(`Hook beforeSave must return object with {ok: true} or { error: 'Error' } `);
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
    const username = authRes.username;
    const userRole = authRes.dbUser.role;
    if (!this.options.allowedUserNames?.includes(username) && !this.options.allowedUserRoles?.includes(userRole)) {
      return { error: 'You are not allowed to perform this action', user: undefined };
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
      path: `/plugin/crud-approve/is2fa-required`,
      noAuth: true,
      handler: async ({ body, adminUser, response, cookies }) => {
        const authRes = this.verifyAuth(cookies);
        if ('error' in authRes) {
          response.status = 403;
          return { error: authRes.error };
        }
        
        const { resourceId } = body;
        const resource = this.adminforth.config.resources.find((res) => res.resourceId == resourceId);
        if (!resource) {
          response.status = 404;
          return { error: 'Resource not found' };
        }

        // find crud plugin on the resource
        const crudApprovePluginInstance = resource.plugins.find((p) => p instanceof CRUDApprovePlugin) as { pluginInstance: CRUDApprovePlugin };
        if (!crudApprovePluginInstance) {
          response.status = 400;
          return { error: 'CRUD Approve Plugin not found on the resource' };
        }

        if (crudApprovePluginInstance.options.call2faModal !== false) {
          let call2faModalFunc: (resource: AdminForthResource, action: AllowedActionsEnum, data: Object, user: AdminUser, oldRecord?: Object, extra?: HttpExtra) => Promise<boolean>;
          if (typeof crudApprovePluginInstance.options.call2faModal === 'function') {
            call2faModalFunc = crudApprovePluginInstance.options.call2faModal;
          } else {
            call2faModalFunc = async () => true;
          }
          const call2faModal = await call2faModalFunc(resource, 'any', {}, authRes);
          return { require2fa: call2faModal };
        }
        return { require2fa: false };
      }
    })
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
        if (this.options.call2faModal === true) {
          const verificationResult = code;
          if (!verificationResult) {
            return { ok: false, error: 'No verification result provided' };
          }
          const t2fa = this.adminforth.getPluginByClassName<TwoFactorsAuthPlugin>('TwoFactorsAuthPlugin');
          const result = await t2fa.verify(verificationResult, {
            adminUser: adminUser,
            userPk: adminUser.pk,
            cookies: cookies
          });

          if (!result?.ok) {
            return { ok: false, error: result?.error ?? 'Provided 2fa verification data is invalid' };
          }
        }
        
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
          const beforeSaveResp = await this.callBeforeSaveHooks(
            resource, action as AllowedActionsEnum, diffData['newRecord'], 
            adminUser, diffRecord[this.options.resourceColumns.recordIdColumnName],
            undefined, diffData['oldRecord'], this.adminforth, undefined
          );
          if (beforeSaveResp.error) {
            response.status = 500;
            return { error: `FailcallBeforeSaveHooksed to apply approved changes: ${beforeSaveResp.error}` };
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
              newRecord, {}, this.adminforth, undefined
            );
          } else if (action === AllowedActionsEnum.edit) {
            const newRecord = diffData['newRecord'];
            const oldRecord = await this.adminforth.connectors[resource.dataSource].getRecordByPrimaryKey(
              resource, diffRecord[this.options.resourceColumns.recordIdColumnName]
            );
            afterSaveResp = await this.callAfterSaveHooks(
              resource, action as AllowedActionsEnum, newRecord, adminUser, 
              recordId, newRecord, oldRecord, this.adminforth, undefined
            );
          } else if (action === AllowedActionsEnum.delete) {
            const newRecord = diffData['newRecord'];
            afterSaveResp = await this.callAfterSaveHooks(
              resource, action as AllowedActionsEnum, newRecord, adminUser, 
              diffRecord[this.options.resourceColumns.recordIdColumnName],
              {}, diffData['oldRecord'], this.adminforth, undefined
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