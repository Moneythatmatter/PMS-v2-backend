import { foModel } from "../../models/front-office/index.js";
import { ActivityType, } from "../../constants/front-office.js";
import { formatTime } from "../../utils/date.js";
import { IdService } from "./id.service.js";
/**
 * Activity / desk logging — one standard format for FO events.
 * Message is prefixed with activity type for searchable history.
 */
export const ActivityService = {
    ActivityType,
    async log(input) {
        return foModel.create(foModel.tables.deskActivity, {
            id: IdService.generateActivity(),
            message: `[${input.type}] ${input.message}`,
            timestamp: formatTime(),
        });
    },
};
//# sourceMappingURL=activity.service.js.map