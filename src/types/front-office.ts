/** Strong domain types for Front Office. */

import type {
  ReservationStatusValue,
} from "../constants/front-office.js";

export interface Guest {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  nationality?: string;
  totalStays?: number;
  loyaltyPoints?: number;
  idType?: string;
  idNumber?: string;
  address?: string;
  memberSince?: string;
  preferences?: string[];
  gender?: string;
  dob?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  createdAt?: string;
}

export interface Reservation {
  id: string;
  guestName: string;
  guestId?: string | null;
  phone?: string;
  email?: string;
  source?: string;
  roomNo?: string | null;
  roomType?: string;
  checkIn: string;
  checkOut: string;
  balance: number;
  status: ReservationStatusValue | string;
  arrivingToday?: boolean;
  bookingType?: string;
  companyName?: string;
  adults?: number;
  children?: number;
  nights?: number;
  tariffPlan?: string;
  mealPlan?: string;
  roomRate?: number;
  totalAmount?: number;
  advancePaid?: number;
  paymentMode?: string;
  specialRequests?: string;
  bookedBy?: string;
  createdAt?: string;
  restaurantBill?: number;
  laundry?: number;
  isVip?: boolean;
}

export interface Payment {
  id: string;
  guestName: string;
  room?: string | null;
  reservationId?: string | null;
  amount: number;
  mode: string;
  type: string;
  transactionNo: string;
  date: string;
  status: string;
  createdAt?: string;
}

export interface Room {
  id?: string;
  roomNo: string;
  roomType?: string;
  status?: string;
  guestName?: string | null;
  housekeeping?: string;
  checkoutDate?: string | null;
}

export interface DeskActivity {
  id: string;
  message: string;
  timestamp: string;
  type?: string;
  guestId?: string | null;
  room?: string | null;
  reservationId?: string | null;
}

export interface InHouseGuest {
  id: string;
  guestName: string;
  room?: string | null;
  roomType?: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  balance: number;
  restaurantBill: number;
  laundry: number;
  status: string;
  isVip: boolean;
  email?: string;
  adults: number;
  children: number;
}

export interface SummaryCard {
  label: string;
  value: number;
  icon: string;
  color: string;
}
