import { maskBirthday, maskEmail, maskName, maskPhone } from '../../shared/utils/mask';
import type { LoyaltyCardDoc, LoyaltyTier } from '../loyalty/schemas/loyalty-card.schema';
import type { CustomerDoc, CustomerStatus } from './schemas/customer.schema';

/**
 * Chuyển CustomerDoc → response. PII (tên, SĐT, email, ngày sinh) LUÔN qua helper che của
 * `shared/utils/mask.ts`; bản đầy đủ chỉ có ở `toRevealed` (endpoint reveal có quyền + audit).
 */

export interface Money {
  amount: number;
  currency: string;
}

export interface CustomerListItem {
  id: string;
  status: CustomerStatus;
  name: string | null;
  phone: string | null;
  visits: number;
  totalSpent: Money;
  lastVisitAt: Date | null;
  loyalty: { tier: LoyaltyTier; points: number } | null;
  anonymizedAt: Date | null;
}

export interface CustomerProfile {
  id: string;
  status: CustomerStatus;
  name: string | null;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  tags: string[];
  note: string | null;
  stats: {
    visits: number;
    totalSpent: Money;
    firstVisitAt: Date | null;
    lastVisitAt: Date | null;
  };
  marketingConsent: boolean;
  createdAt: Date;
  anonymizedAt: Date | null;
}

export interface RevealedCustomer {
  name: string | null;
  phone: string | null;
  email: string | null;
  /** YYYY-MM-DD */
  birthday: string | null;
}

function totalSpentOf(c: CustomerDoc): Money {
  return {
    amount: c.stats?.totalSpent?.amount ?? 0,
    currency: c.stats?.totalSpent?.currency ?? 'VND',
  };
}

export function toListItem(c: CustomerDoc, card: LoyaltyCardDoc | null): CustomerListItem {
  return {
    id: c.id,
    status: c.status,
    name: maskName(c.name),
    phone: maskPhone(c.phone),
    visits: c.stats?.orderCount ?? 0,
    totalSpent: totalSpentOf(c),
    lastVisitAt: c.stats?.lastOrderAt ?? null,
    loyalty: card ? { tier: card.tier, points: card.points } : null,
    anonymizedAt: c.dataErasureRequestedAt ?? null,
  };
}

export function toProfile(c: CustomerDoc): CustomerProfile {
  return {
    id: c.id,
    status: c.status,
    name: maskName(c.name),
    phone: maskPhone(c.phone),
    email: maskEmail(c.email),
    birthday: maskBirthday(c.birthday),
    tags: c.tags ?? [],
    note: c.note ?? null,
    stats: {
      visits: c.stats?.orderCount ?? 0,
      totalSpent: totalSpentOf(c),
      firstVisitAt: c.stats?.firstOrderAt ?? null,
      lastVisitAt: c.stats?.lastOrderAt ?? null,
    },
    marketingConsent: c.consents?.marketing?.granted ?? false,
    createdAt: c.createdAt,
    anonymizedAt: c.dataErasureRequestedAt ?? null,
  };
}

export function toRevealed(c: CustomerDoc): RevealedCustomer {
  const birthday = c.birthday ? new Date(c.birthday) : null;
  return {
    name: c.name ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
    birthday:
      birthday && !Number.isNaN(birthday.getTime()) ? birthday.toISOString().slice(0, 10) : null,
  };
}
