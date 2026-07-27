import { foModel } from "../../models/front-office/index.js";
import {
  ActivityType,
  type ActivityTypeValue,
} from "../../constants/front-office.js";
import { formatTime } from "../../utils/date.js";
import { IdService } from "./id.service.js";

type LogInput = {
  type: ActivityTypeValue;
  message: string;
  guestId?: string | null;
  room?: string | null;
  reservationId?: string | null;
};

/**
 * Activity / desk logging — one standard format for FO events.
 * Message is prefixed with activity type for searchable history.
 */
export const ActivityService = {
  ActivityType,

  async log(input: LogInput) {
    return foModel.create(foModel.tables.deskActivity, {
      id: IdService.generateActivity(),
      message: `[${input.type}] ${input.message}`,
      timestamp: formatTime(),
    });
  },
};
