// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { measureNaturalTableWidths } from '../src/layoutMeasurements';

afterEach(() => document.body.replaceChildren());

it('prepares all tables before measuring and restores their styles', () => {
  document.body.innerHTML = '<div class="table-frame"><div class="table-wrap"><table style="width:50%!important"></table></div></div><div class="table-frame"><div class="table-wrap"><table></table></div></div>';
  const frames = [...document.body.children] as HTMLElement[];
  const tables = [...document.querySelectorAll('table')];
  for (const table of tables) Object.defineProperty(table, 'offsetWidth', { get: () => {
    expect(tables.every((other) => other.style.width === 'max-content')).toBe(true);
    return 900;
  } });
  expect(measureNaturalTableWidths(frames)).toEqual(frames.map((frame) => ({ frame, width: 900 })));
  expect(tables[0].style.width).toBe('50%'); expect(tables[0].style.getPropertyPriority('width')).toBe('important');
  expect(tables[1].style.width).toBe('');
});

it('restores temporary styles even when a measurement fails', () => {
  const frame = document.createElement('div'); frame.innerHTML = '<div class="table-wrap"><table></table></div>';
  const table = frame.querySelector('table')!;
  Object.defineProperty(table, 'offsetWidth', { get: () => { throw new Error('measurement'); } });
  expect(() => measureNaturalTableWidths([frame])).toThrow('measurement'); expect(table.style.width).toBe('');
});
