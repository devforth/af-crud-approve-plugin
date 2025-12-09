import { AdminForthPlugin } from "adminforth";
import { IAdminForth, IHttpServer, AdminForthResourcePages, AdminForthResourceColumn, AdminForthDataTypes, AdminForthResource, AllowedActionsEnum, HttpExtra, AdminUser } from "adminforth";
import { ApprovalStatusEnum, type PluginOptions } from './types.js';


export default class CRUDApprovePlugin extends AdminForthPlugin {
  options: PluginOptions;
  adminforth: IAdminForth;

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

    resourceConfig.hooks.create.beforeSave.push(async ({ resource, record, adminUser, extra }) => {
      // intercept create action and create approval request instead
      console.log('Intercepting create action for resource:', resource.resourceId);
      await this.createApprovalRequest(resource, AllowedActionsEnum.create, null, record, adminUser, extra);
      // prevent actual creation
      throw new Error('Changes sent for approval');
    });

    resourceConfig.hooks.edit.afterSave.push(async ({ resource, updates, adminUser, oldRecord, extra }) => {
      // intercept update action and create approval request instead
      console.log('Intercepting update action for resource:', resource.resourceId);
      await this.createApprovalRequest(resource, AllowedActionsEnum.edit, oldRecord, updates, adminUser, extra);
      // prevent actual update
      throw new Error('Changes sent for approval');
    });

    resourceConfig.hooks.delete.afterSave.push(async ({ resource, record, adminUser, extra }) => {
      // intercept delete action and create approval request instead
      console.log('Intercepting delete action for resource:', resource.resourceId);
      await this.createApprovalRequest(resource, AllowedActionsEnum.delete, record, null, adminUser, extra);
      // prevent actual deletion
      throw new Error('Changes sent for approval');
    });

  }

  async createApprovalRequest(resource: AdminForthResource, action: AllowedActionsEnum, oldData: any, newData: any, user: AdminUser, extra?: HttpExtra) {
    // create a record in diff table with oldData and newData
    const pkColumnName = this.options.resourceColumns.resourceIdColumnName 
    const record = {
      [this.options.resourceColumns.resourceIdColumnName]: oldData ? oldData[pkColumnName] : newData[pkColumnName],
      [this.options.resourceColumns.resourceActionColumnName]: action,
      [this.options.resourceColumns.resourceOldDataColumnName]: oldData ? JSON.stringify(oldData) : null,
      [this.options.resourceColumns.resourceNewDataColumnName]: newData ? JSON.stringify(newData) : null,
      [this.options.resourceColumns.resourceStatusColumnName]: ApprovalStatusEnum.PENDING,
      [this.options.resourceColumns.resourceCreatedAtColumnName]: new Date().toISOString(),
      // You can add userId from extra if you have authentication implemented
      [this.options.resourceColumns.resourceUserIdColumnName]: user.pk,
    }
    const approvalResource = this.adminforth.config.resources.find(r => r.resourceId === this.options.diffTableName);
    const result = await this.adminforth.createResourceRecord({ resource: approvalResource, record, adminUser: user });
    return result;
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