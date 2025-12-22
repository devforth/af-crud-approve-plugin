import { AdminForthResource, AdminUser, AllowedActionsEnum, HttpExtra } from "adminforth";

export interface PluginOptions {
    /**
     * User names allowed to perform approve/reject actions. If both allowedUserNames and allowedUserRoles are empty, nobody will be able to approve/reject.
     */
    allowedUserNames?: string[];
    /**
     * User roles allowed to perform approve/reject actions. If both allowedUserNames and allowedUserRoles are empty, nobody will be able to approve/reject.
     */
    allowedUserRoles?: string[];
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