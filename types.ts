import { AdminForthResource, AdminUser, AllowedActionsEnum, HttpExtra } from "adminforth";

export interface PluginOptions {
    /**
     * Table where diffs are stored.
     */
    diffTableName: string;
    /**
     * User names allowed to perform approve/reject actions. If both allowedUserNames and allowedUserRoles are empty, nobody will be able to approve/reject.
     */
    allowedUserNames?: string[];
    /**
     * User roles allowed to perform approve/reject actions. If both allowedUserNames and allowedUserRoles are empty, nobody will be able to approve/reject.
     */
    allowedUserRoles?: string[];
    /**
     * Whether to review create/update/delete actions. You can pass functions here as well for more complex logic.
     */
    shouldReview: boolean | ((resource: AdminForthResource, action: AllowedForReviewActionsEnum, data: Object, user: AdminUser, oldRecord?: Object, extra?: HttpExtra) => Promise<boolean>);
    /**
     * Whether to call 2fa modal before creating approval request. If used on diffTable resource, 2fa will be called on approve/reject actions.
     */
    call2faModal: boolean;
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
    delete = AllowedActionsEnum.delete
}

export enum ApprovalStatusEnum {
    pending = 'pending',
    approved = 'approved',
    rejected = 'rejected'
}