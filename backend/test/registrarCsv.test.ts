import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import path from 'path';
import { parseCsv, parseRegistrarCsv } from '../src/domain/registrarCsv';

const sample = (name: string) => readFileSync(path.join(__dirname, '..', '..', 'db', 'sample-registrar', name), 'utf8');
const KNOWN = new Set(['applied-cs', 'cis-cs', 'cnc']);

test('parseCsv handles quotes, escaped quotes, CRLF and BOM', () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"']]);
});

test('a file with the wrong header is a structural error', () => {
  const r = parseRegistrarCsv(sample('registrar_broken.csv'), KNOWN);
  assert.match(r.structuralError ?? '', /Missing columns/);
  assert.equal(r.students.length, 0);
});

test('invalid rows reject the whole student; valid students still apply', () => {
  const r = parseRegistrarCsv(sample('registrar_with_errors.csv'), KNOWN);
  assert.equal(r.structuralError, null);
  assert.deepEqual(r.students.map((s) => s.studentCode), ['6609650012']);
  const fields = r.errors.filter((e) => e.line > 0).map((e) => e.field).sort();
  assert.deepEqual(fields, ['credits', 'curriculum_code', 'grade']);
  assert.ok(r.errors.every((e) => e.studentCode === '6609650011'));
  assert.ok(r.records.every((x) => x.studentCode === '6609650012'));
});

test('student-only rows (no course yet) are accepted', () => {
  const header = 'student_code,full_name,email,curriculum_code,plan,enrollment_year,advisor_email,academic_status,financial_status,outstanding_amount,gpax,regular_semesters,course_code,academic_year,semester,grade,credits';
  const r = parseRegistrarCsv(`${header}\n6909650001,New Student,,applied-cs,โครงงาน,2569,,normal,clear,,,0,,,,,\n`, KNOWN);
  assert.equal(r.errors.length, 0);
  assert.equal(r.students.length, 1);
  assert.equal(r.records.length, 0);
});

test('duplicate course in the same term is rejected', () => {
  const header = 'student_code,full_name,email,curriculum_code,plan,enrollment_year,advisor_email,academic_status,financial_status,outstanding_amount,gpax,regular_semesters,course_code,academic_year,semester,grade,credits';
  const row = '6909650001,A,,applied-cs,โครงงาน,2569,,normal,clear,,,1,CS101,2569,1,A,3';
  const r = parseRegistrarCsv(`${header}\n${row}\n${row}\n`, KNOWN);
  assert.equal(r.students.length, 0);
  assert.ok(r.errors.some((e) => /twice/.test(e.message)));
});
