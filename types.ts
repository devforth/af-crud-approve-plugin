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

    /**
     * By default the user who created the approval request can't approve or reject it himself
     * (separation of duties / four-eyes principle). Set to true to disable this check.
     */
    allowSelfApproval?: boolean;
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