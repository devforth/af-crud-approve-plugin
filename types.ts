export interface PluginOptions {
    /**
     * Table where diffs are stored.
     */
    diffTableName: string;
    /**
     * Roles allowed to approve/reject changes.
     */
    allowedRoles?: string[];
    /**
     * Users allowed to approve/reject changes.
     */
    allowedUsers?: string[];
    
    resourceColumns: {
        resourceIdColumnName: string;
        resourceRecordIdColumnName: string;
        resourceActionColumnName: string;
        resourceDataColumnName: string;
        resourceUserIdColumnName: string;
        resourceStatusColumnName: string;
        resourceCreatedAtColumnName: string;
    }
}

export enum ApprovalStatusEnum {
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected'
}