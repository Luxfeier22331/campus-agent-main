import { describe, expect, it } from 'vitest';
import { dueReview } from '../src/notice-runner.ts';
const range={coveredFrom:'2026-09-01',coveredUntil:'2026-10-03',updatedAt:'2026-10-02T00:00:00Z'};
describe('periodic notice review',()=>{
 it('runs a full review for old states with no review timestamp',()=>expect(dueReview(range,'2026-10-02T00:00:00Z')).toBe('full'));
 it('uses daily recent and weekly full deadlines',()=>{
  const state={...range,recentReviewedAt:'2026-10-01T00:00:00Z',fullReviewedAt:'2026-09-28T00:00:00Z'};
  expect(dueReview(state,'2026-10-01T23:59:59Z')).toBeNull();
  expect(dueReview(state,'2026-10-02T00:00:00Z')).toBe('recent');
  expect(dueReview({...state,recentReviewedAt:'2026-10-05T00:00:00Z'},'2026-10-05T00:00:00Z')).toBe('full');
 });
});
