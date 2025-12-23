import { AdminForthResource, AdminUser, AllowedActionsEnum, HttpExtra } from "adminforth";

export interface PluginOptions {
    /**
     * Column names mapping in the diff table.
     */
    resourceColumns: {
        idColumnName: string;
        recordIdColumnName: string;
        resourceIdColumnName: string;
        actionColumnName: string;
        dataColumnName: string;
        userIdColumnName: string;
        responserIdColumnName: string;
        statusColumnName: string;
        createdAtColumnName: string;
        extraColumnName: string;
    }
}

export enum AllowedForReviewActionsEnum {
    create = AllowedActionsEnum.create,
    edit = AllowedActionsEnum.edit,
    delete = AllowedActionsEnum.delete,
    custom = 'custom',
}

export enum ApprovalStatusEnum {
    pending = 1,
    approved = 2,
    rejected = 3
}