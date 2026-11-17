import { describe, expect, it } from 'vitest';
import { inventoryValue, orderTotals, parseQty, receiptStatus, reorderSuggestions, weightedAverage } from '@/modules/lager/calc';
import { campaignMetrics, funnel, shouldPurge } from '@/modules/marknad/calc';

describe('lager', () => {
  it('vägt genomsnittspris', () => {
    expect(weightedAverage(20, 12000, 10, 15000)).toBe(13000);
    expect(weightedAverage(0, 0, 5, 4999)).toBe(4999);
    expect(weightedAverage(-2, 1000, 5, 2000)).toBe(2000); // negativt saldo räknas som noll
  });
  it('ordersummor per momssats', () => {
    expect(orderTotals([{ qty: 3, unit_price: 29900, vat_rate: 25 }, { qty: 2, unit_price: 10000, vat_rate: 6 }])).toEqual({ net: 109700, vat: 22425 + 1200, total: 133325 });
  });
  it('beställningsförslag', () => {
    const s = reorderSuggestions([
      { id: 1, sku: 'A', name: 'a', supplier_id: 1, on_hand: 5, on_order: 0, reserved: 0, reorder_point: 10, reorder_qty: 50 },
      { id: 2, sku: 'B', name: 'b', supplier_id: 1, on_hand: 5, on_order: 10, reserved: 0, reorder_point: 10, reorder_qty: 50 },
      { id: 3, sku: 'C', name: 'c', supplier_id: 1, on_hand: 2, on_order: 0, reserved: 0, reorder_point: 30, reorder_qty: 5 },
    ]);
    expect(s.map((x) => [x.sku, x.suggested])).toEqual([['A', 50], ['C', 28]]);
  });
  it('lagervärde med 97 %-regeln', () => {
    expect(inventoryValue([{ qty: 52, avg_cost: 5000 }, { qty: 27, avg_cost: 13000 }], true)).toEqual({ cost: 611000, book: 592670 });
    expect(inventoryValue([{ qty: -1, avg_cost: 5000 }]).cost).toBe(0);
  });
  it('inleveransstatus och antal', () => {
    expect(receiptStatus([{ qty: 10, received: 10 }])).toBe('received');
    expect(receiptStatus([{ qty: 10, received: 4 }, { qty: 2, received: 0 }])).toBe('partial');
    expect(receiptStatus([{ qty: 10, received: 0 }])).toBe('sent');
    expect(parseQty('1,5')).toBe(1.5);
    expect(parseQty('')).toBeNull();
  });
});

describe('marknadsföring', () => {
  it('nyckeltal per kampanj', () => {
    expect(campaignMetrics({ budget: 1000000, cost: 250000, leads: 2, won: 1, revenue: 400000 })).toEqual({ cpl: 125000, cpa: 250000, conversion: 50, roi: 60, budgetUsed: 25 });
    expect(campaignMetrics({ budget: 0, cost: 0, leads: 0, won: 0, revenue: 0 })).toEqual({ cpl: null, cpa: null, conversion: null, roi: null, budgetUsed: null });
  });
  it('tratt', () => {
    expect(funnel({ new: 3, contacted: 2, qualified: 1, won: 1, lost: 2 }).map((f) => f.n)).toEqual([9, 4, 2, 1]);
  });
  it('gallring efter 24 månader', () => {
    expect(shouldPurge({ status: 'lost', consent: true, updated: '2024-10-01', customer_id: null }, '2026-11-17')).toBe(true);
    expect(shouldPurge({ status: 'new', consent: true, updated: '2024-10-01', customer_id: null }, '2026-11-17')).toBe(false);
    expect(shouldPurge({ status: 'new', consent: false, updated: '2024-10-01', customer_id: null }, '2026-11-17')).toBe(true);
    expect(shouldPurge({ status: 'lost', consent: false, updated: '2025-06-01', customer_id: null }, '2026-11-17')).toBe(false);
    expect(shouldPurge({ status: 'won', consent: false, updated: '2020-01-01', customer_id: 5 }, '2026-11-17')).toBe(false);
  });
});
