export declare const modifierTables: {
    readonly groups: "fb_modifier_groups";
    readonly options: "fb_modifiers";
    readonly itemGroups: "fb_menu_item_modifier_groups";
};
export type SelectionType = "single" | "multiple";
export type ModifierOption = {
    id: string;
    groupId: string;
    code: string;
    name: string;
    price: number;
    isDefault: boolean;
    sortOrder: number;
    status: "Active" | "Inactive";
};
export type ModifierGroup = {
    id: string;
    code: string;
    name: string;
    description: string;
    selectionType: SelectionType;
    isRequired: boolean;
    minSelect: number;
    /** null = no upper limit */
    maxSelect: number | null;
    sortOrder: number;
    status: "Active" | "Inactive";
    options: ModifierOption[];
    menuItemIds: string[];
    createdAt: string;
};
/** Snapshot stored on fb_order_items.modifiers. */
export type SelectedModifier = {
    groupId: string;
    groupName: string;
    modifierId: string;
    name: string;
    price: number;
};
export declare function listGroups(): Promise<ModifierGroup[]>;
export declare function getGroup(id: string): Promise<ModifierGroup | null>;
/** Active groups for these menu items, in the item's display order, with active options only. */
export declare function groupsForMenuItems(menuItemIds: string[]): Promise<Map<string, ModifierGroup[]>>;
export declare function ruleText(group: Pick<ModifierGroup, "isRequired" | "minSelect" | "maxSelect" | "selectionType">): string;
/** Validate chosen option ids for one menu item and price them from the database. */
export declare function resolveSelections(itemName: string, groups: ModifierGroup[], modifierIds: string[]): {
    selected: SelectedModifier[];
    total: number;
};
export declare function saveGroup(id: string | null, body: Record<string, unknown>): Promise<ModifierGroup>;
export declare function deleteGroup(id: string): Promise<void>;
