import { describe, expect, it } from 'vitest';
import { guessMapping, planImport, quickPlan, readSheet, readStage, splitName, type ImportOptions, type Sheet } from '../src/crm/csvImport';
import { blankCustomer } from '../src/crm/store';

const opts: ImportOptions = { fileName: 'list.csv', stage: 'new', source: 'Import: list', fillExisting: true };
// Same shape as a commercial contact list (made-up people and businesses): people and
// business-only rows, coworkers sharing the main line, one person at two offices.
const LIST = [
  'Name,Business Name,Title,Phone Number,Email,Location',
  'Ava Lynn Carter,Riverbend Paving Co.,Vice President,256-555-2201,ava@riverbend.example,"100 Mill Rd, Florence, AL"',
  'Beth Carter,Riverbend Paving Co.,President,256-555-2201,beth@riverbend.example,"100 Mill Rd, Florence, AL"',
  ',Hollow Creek Contracting,,,,"Memphis, TN"',
  ',Summit Equipment Rental,,256-555-2301,,"1 Depot St, Decatur, AL"',
  ',Summit Equipment Rental,,256-555-2302,,"2 Depot St, Athens, AL"',
  ',Northgate Industries,Shared inbox,256-555-2401,office@northgate.example,"Sheffield, AL"',
  ',Northgate Industries (Tuscumbia),Shared inbox,256-555-2402,office@northgate.example,"Tuscumbia, AL"',
  'Cole Dawson,Ridgeline Aggregates - North,Bids,256-555-2501,cole@ridgeline.example,"Killen, AL"',
  'Cole Dawson,Ridgeline Aggregates - South,Bids,256-555-2502,cole@ridgeline.example,"Russellville, AL"',
].join('\r\n');

describe('importing customers from a CSV', () => {
  it('matches columns by their header', () => {
    expect(guessMapping(['Name', 'Business Name', 'Title', 'Phone Number', 'Email', 'Location'])).toEqual(['fullName', 'company', 'title', 'phone', 'email', 'street']);
    expect(guessMapping(['First Name', 'Last Name', 'Cell', 'Home Phone', 'E-mail', 'Vehicle of Interest', 'Lead Source', 'Status', 'Comments'])).toEqual([
      'firstName', 'lastName', 'phone', 'altPhone', 'email', 'interest', 'source', 'stage', 'notes',
    ]);
    expect(guessMapping(['Phone', 'Phone']).slice(0, 2)).toEqual(['phone', 'altPhone']);
  });

  it('people who share a company line stay separate; business-only rows are named by the business', () => {
    const p = quickPlan(LIST, [], opts);
    if ('error' in p) throw new Error(p.error);
    const names = p.add.map((c) => `${c.firstName} ${c.lastName}`.trim() || c.company);
    expect(names).toEqual(['Ava Lynn Carter', 'Beth Carter', 'Summit Equipment Rental', 'Summit Equipment Rental', 'Northgate Industries', 'Northgate Industries (Tuscumbia)', 'Cole Dawson']);
    expect(p.add[1]).toMatchObject({ company: 'Riverbend Paving Co.', title: 'President', phone: '(256) 555-2201', address: '100 Mill Rd, Florence, AL', source: 'Import: list', stage: 'new' });
    // The same person at a second office: one customer, both numbers.
    expect(p.add[6]).toMatchObject({ phone: '(256) 555-2501', altPhone: '(256) 555-2502' });
    expect(p.repeats).toBe(1);
    expect(p.skipped).toEqual([{ line: 4, reason: 'Hollow Creek Contracting: no phone or email' }]);
  });

  it('importing the same file twice adds no one; fill-in only adds what is missing', () => {
    const first = quickPlan(LIST, [], opts);
    if ('error' in first) throw new Error(first.error);
    const again = quickPlan(LIST, first.add, opts);
    if ('error' in again) throw new Error(again.error);
    expect(again.add).toHaveLength(0);
    expect(again.update).toHaveLength(0);
    const have = blankCustomer({ firstName: 'Beth', lastName: 'Carter', phone: '(256) 555-2201', notes: 'Met at the expo' });
    const p = quickPlan(LIST, [have], opts);
    if ('error' in p) throw new Error(p.error);
    expect(p.update).toEqual([{ id: have.id, name: 'Beth Carter', patch: { company: 'Riverbend Paving Co.', title: 'President', email: 'beth@riverbend.example', address: '100 Mill Rd, Florence, AL' } }]);
    const off = quickPlan(LIST, [have], { ...opts, fillExisting: false });
    if ('error' in off) throw new Error(off.error);
    expect(off.update).toHaveLength(0);
    expect(off.unchanged).toBe(1);
  });

  it('reads names, stages, do-not-text and Excel quirks', () => {
    expect(splitName('Smith, John')).toEqual({ firstName: 'John', lastName: 'Smith' });
    expect(readStage('Sold')).toBe('sold');
    expect(readStage('Appt set')).toBe('appointment');
    expect(readStage('whatever')).toBeNull();
    const sheet = readSheet('﻿sep=,\r\nFIRST,LAST,CELL,STATUS,DNT\r\nJOHN,SMITH,2565552601,lost,yes\r\n\r\n') as Sheet;
    const p = planImport(sheet, guessMapping(sheet.headers), [], opts);
    expect(p.add[0]).toMatchObject({ firstName: 'John', lastName: 'Smith', phone: '(256) 555-2601', stage: 'lost', doNotText: true });
    expect(readSheet('Name,Phone\r\n')).toEqual({ error: 'The file has a header row but no customers under it.' });
  });
});
