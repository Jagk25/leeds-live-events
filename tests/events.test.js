import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHumanDate, iso } from '../lib/events.js';

const FIXED_NOW = new Date('2026-08-24T12:00:00Z');

test('parses weekday + day + month + time (Skiddle/Fatsoma style)', () => {
  const result = parseHumanDate('Sat 22 Aug, 10:00', FIXED_NOW);
  assert.ok(result, 'expected a parsed date');
  assert.equal(result.slice(0, 10), '2027-08-22'); // past this run -> rolls to next year
});

test('parses ordinal day + month + year (Visit Leeds style)', () => {
  const result = parseHumanDate('22nd Aug 2026, 7:30pm', FIXED_NOW);
  assert.ok(result);
  assert.equal(result.slice(0, 10), '2026-08-22');
  assert.equal(result.slice(11, 16), '19:30');
});

test('parses am/pm correctly including 12am/12pm edge cases', () => {
  const noon = parseHumanDate('1 Sep 2026, 12:00pm', FIXED_NOW);
  const midnight = parseHumanDate('1 Sep 2026, 12:00am', FIXED_NOW);
  assert.equal(noon.slice(11, 13), '12');
  assert.equal(midnight.slice(11, 13), '00');
});

test('rejects garbage / non-date strings instead of returning a phantom date', () => {
  assert.equal(parseHumanDate('', FIXED_NOW), null);
  assert.equal(parseHumanDate('Date on listing', FIXED_NOW), null);
  assert.equal(parseHumanDate('View event', FIXED_NOW), null);
});

test('iso() fast-paths real ISO 8601 strings without touching the human parser', () => {
  const result = iso('2026-09-05T18:30:00.000Z');
  assert.equal(result, '2026-09-05T18:30:00.000Z');
});

test('iso() falls back to human parser for non-ISO strings', () => {
  const result = iso('Sat 22 Aug 2026, 10:00');
  assert.equal(result.slice(0, 10), '2026-08-22');
});

test('iso() returns null (not a placeholder) when nothing parseable is found', () => {
  assert.equal(iso('Book now'), null);
  assert.equal(iso(''), null);
  assert.equal(iso(null), null);
});
