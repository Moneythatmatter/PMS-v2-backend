/** Ensure required document fields before insert into ps_* tables. */
export declare function withPsDocumentDefaults(body: Record<string, unknown>, options: {
    numberField: string;
    prefix: string;
    dateDefaults?: Record<string, string>;
}): Record<string, unknown>;
