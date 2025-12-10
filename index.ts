import { ActionCheckSource, AdminForthPlugin, AdminForthSortDirections } from "adminforth";
import { IAdminForth, AdminForthDataTypes, AdminForthResource, AllowedActionsEnum, HttpExtra, AdminUser } from "adminforth";
import { ApprovalStatusEnum, type PluginOptions } from './types.js';
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
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
      let diffColumn = resourceConfig.columns.find((c) => c.name === this.options.resourceColumns.resourceDataColumnName); 
      if (!diffColumn) {
        throw new Error(`Column ${this.options.resourceColumns.resourceDataColumnName} not found in ${resourceConfig.label}`)
      }
      if (diffColumn.type !== AdminForthDataTypes.JSON) {
        throw new Error(`Column ${this.options.resourceColumns.resourceDataColumnName} must be of type 'json'`)
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
        columnName: this.options.resourceColumns.resourceCreatedAtColumnName,
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

    resourceConfig.hooks.edit.afterSave.unshift(async ({ resource, updates, adminUser, oldRecord, extra }) => {
      // intercept update action and create approval request instead
      const res = await this.createApprovalRequest(resource, AllowedActionsEnum.edit, updates, adminUser, oldRecord, extra);
      if (!res) {
        return {ok: true};
      }
      // prevent actual update
      return {ok: false, error: 'Update pending approval' };
    });

    resourceConfig.hooks.delete.afterSave.unshift(async ({ resource, record, adminUser, extra }) => {
      // intercept delete action and create approval request instead
      const res = await this.createApprovalRequest(resource, AllowedActionsEnum.delete, record, adminUser, null, extra);
      if (!res) {
        return {ok: true};
      }
      // prevent actual deletion
      return {ok: false, error: 'Deletion pending approval' };
    });

  }

  createApprovalRequest = async (resource: AdminForthResource, action: AllowedActionsEnum | string, data: Object, user: AdminUser, oldRecord?: Object, extra?: HttpExtra) => {
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
    const connector = this.adminforth.connectors[resource.dataSource];

    const newRecord = action == AllowedActionsEnum.delete ? {} : (await connector.getRecordByPrimaryKey(resource, recordId)) || {};
    if (action !== AllowedActionsEnum.delete) {
      oldRecord = oldRecord ? JSON.parse(JSON.stringify(oldRecord)) : {};
    } else {
      oldRecord = data
    }

    if (action !== AllowedActionsEnum.delete) {
      const columnsNamesList = resource.columns.map((c) => c.name);
      columnsNamesList.forEach((key) => {
        if (JSON.stringify(oldRecord[key]) == JSON.stringify(newRecord[key])) {
          delete oldRecord[key];
          delete newRecord[key];
        }
      });
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

    const record = {
      [this.options.resourceColumns.resourceIdColumnName]: resource.resourceId,
      [this.options.resourceColumns.resourceActionColumnName]: action,
      [this.options.resourceColumns.resourceStatusColumnName]: ApprovalStatusEnum.pending,
      [this.options.resourceColumns.resourceDataColumnName]: { 'oldRecord': oldRecord || {}, 'newRecord': newRecord },
      [this.options.resourceColumns.resourceUserIdColumnName]: user.pk,
      [this.options.resourceColumns.resourceRecordIdColumnName]: recordId,
      // utc iso string
      [this.options.resourceColumns.resourceCreatedAtColumnName]: dayjs.utc().format(),
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
      [this.options.resourceColumns.resourceActionColumnName]: actionId,
      [this.options.resourceColumns.resourceDataColumnName]: { 'oldRecord': oldData || {}, 'newRecord': data },
      [this.options.resourceColumns.resourceUserIdColumnName]: user.pk,
      [this.options.resourceColumns.resourceIdColumnName]: recordId,
      [this.options.resourceColumns.resourceCreatedAtColumnName]: dayjs.utc().format(),
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
}