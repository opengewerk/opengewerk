import { describe, expect, it } from 'vitest'

import { type Catalogue, catalogueDeviations, type TableCatalogue } from './catalogue.js'

// The comparison on catalogues written by hand. Whether a real database says
// what the blocks say is asked where there is one: in the application, against
// its own migrations. Here it is what counts as a deviation and what does not,
// each seen once in both directions.

function table(changes: Partial<TableCatalogue> = {}): TableCatalogue {
  return {
    columns: { id: 'uuid not null default uuidv7()', name: 'text not null' },
    constraints: { probe_pkey: 'PRIMARY KEY (id)' },
    indexes: { probe_name_idx: 'CREATE INDEX probe_name_idx ON public.probe USING btree (name)' },
    policies: { tenant_isolation: 'PERMISSIVE for ALL to opengewerk_app using (true)' },
    triggers: { audit_changes: 'CREATE TRIGGER audit_changes AFTER INSERT ON public.probe' },
    rowSecurity: 'enabled, forced',
    grants: 'INSERT, SELECT',
    ...changes,
  }
}

function catalogue(changes: Partial<Catalogue> = {}): Catalogue {
  return {
    tables: { probe: table() },
    enums: { probe_kind: 'one, two' },
    functions: {
      'probe_count()':
        'CREATE OR REPLACE FUNCTION public.probe_count()\n RETURNS bigint\nAS $function$\n\tSELECT 1\n$function$\n-- may be called by: opengewerk_app',
    },
    schema: 'usage',
    ...changes,
  }
}

const blocks = catalogue()

describe('a database held against the foundation', () => {
  it('has nothing to report when it says the same', () => {
    expect(catalogueDeviations(blocks, catalogue())).toEqual([])
  })

  it('is not asked about what the application has of its own', () => {
    const application = catalogue({
      tables: { probe: table(), customers: table({ grants: 'DELETE' }) },
      enums: { probe_kind: 'one, two', customer_kind: 'private, business' },
      functions: { ...blocks.functions, 'stays_as_written()': 'CREATE FUNCTION ...' },
    })

    expect(catalogueDeviations(blocks, application)).toEqual([])
  })

  it('misses a table, a type and a function of the foundation', () => {
    expect(
      catalogueDeviations(blocks, catalogue({ tables: {}, enums: {}, functions: {} })),
    ).toEqual([
      'table probe: missing in the database',
      'enum probe_kind: missing in the database',
      'function probe_count(): missing in the database',
    ])
  })

  it('reports a column that says something else, with both sides', () => {
    const application = catalogue({
      tables: { probe: table({ columns: { ...table().columns, name: 'text' } }) },
    })

    expect(catalogueDeviations(blocks, application)).toEqual([
      'table probe, column name: line 1: the blocks say "text not null", the database says "text"',
    ])
  })

  it.each([
    ['column', { columns: { ...table().columns, motto: 'text' } }, 'column motto'],
    [
      'constraint',
      { constraints: { ...table().constraints, probe_name_key: 'UNIQUE (name)' } },
      'constraint probe_name_key',
    ],
    [
      'policy',
      { policies: { ...table().policies, open: 'PERMISSIVE for ALL to public using true' } },
      'policy open',
    ],
  ] as const)('reports a %s more than the foundation gave the table', (_what, changes, named) => {
    // Each of them changes what the foundation promises about the table: a
    // column the fingerprint of a row covers, a key a write can fail on, a
    // policy that opens what the others close.
    expect(catalogueDeviations(blocks, catalogue({ tables: { probe: table(changes) } }))).toEqual([
      `table probe, ${named}: in the database and in no block`,
    ])
  })

  it('reports a right more, and row level security that does not hold for the owner', () => {
    const application = catalogue({
      tables: {
        probe: table({ grants: 'DELETE, INSERT, SELECT', rowSecurity: 'enabled, not forced' }),
      },
    })

    expect(catalogueDeviations(blocks, application)).toEqual([
      'table probe, row level security: line 1: the blocks say "enabled, forced", the database says "enabled, not forced"',
      'table probe, grants: line 1: the blocks say "INSERT, SELECT", the database says "DELETE, INSERT, SELECT"',
    ])
  })

  it('reports a trigger and an index more, unless the application names them as its own', () => {
    const application = catalogue({
      tables: {
        probe: table({
          triggers: { ...table().triggers, instance_changes: 'CREATE TRIGGER instance_changes' },
          indexes: { ...table().indexes, probe_lookup_idx: 'CREATE INDEX probe_lookup_idx' },
        }),
      },
    })

    // Unnamed, they are either missing from the blocks or should not be there,
    // and which of the two is for a person to decide.
    expect(catalogueDeviations(blocks, application)).toEqual([
      'table probe, index probe_lookup_idx: in the database and in no block',
      'table probe, trigger instance_changes: in the database and in no block',
    ])
    expect(
      catalogueDeviations(blocks, application, {
        triggers: ['probe.instance_changes'],
        indexes: ['probe.probe_lookup_idx'],
      }),
    ).toEqual([])
  })

  it('reports a column and a key more, unless the application names them as its own', () => {
    // The outbox of the mail is the one table made to carry columns of an
    // application, for the records its messages are about (#23).
    const application = catalogue({
      tables: {
        probe: table({
          columns: { ...table().columns, parcel_id: 'uuid' },
          constraints: {
            ...table().constraints,
            probe_parcel_in_tenant: 'FOREIGN KEY (parcel_id) REFERENCES parcels(id)',
          },
        }),
      },
    })

    expect(catalogueDeviations(blocks, application)).toEqual([
      'table probe, column parcel_id: in the database and in no block',
      'table probe, constraint probe_parcel_in_tenant: in the database and in no block',
    ])
    expect(
      catalogueDeviations(blocks, application, {
        columns: ['probe.parcel_id'],
        constraints: ['probe.probe_parcel_in_tenant'],
      }),
    ).toEqual([])
  })

  it('reports a policy more, unless the application names it as its own and it is restrictive', () => {
    // A restrictive policy can only take rows away from what the others give,
    // the rows of the other areas of a tenant for one
    // (opengewerk-haustechnik#25). A permissive one opens what the others
    // close, named or not.
    const application = catalogue({
      tables: {
        probe: table({
          policies: {
            ...table().policies,
            within_areas:
              'RESTRICTIVE for ALL to opengewerk_app using (area_id = ANY (session_areas()))',
            open: 'PERMISSIVE for ALL to public using true',
          },
        }),
      },
    })

    expect(catalogueDeviations(blocks, application)).toEqual([
      'table probe, policy within_areas: in the database and in no block',
      'table probe, policy open: in the database and in no block',
    ])
    expect(catalogueDeviations(blocks, application, { policies: ['probe.within_areas'] })).toEqual([
      'table probe, policy open: in the database and in no block',
    ])
    expect(
      catalogueDeviations(blocks, application, {
        policies: ['probe.within_areas', 'probe.open'],
      }),
    ).toEqual([
      "table probe, policy open: named as the application's own and permissive; only a restrictive policy may be, because a permissive one opens what the others close",
    ])
  })

  it('reports a policy of the blocks that says something else, whatever is named', () => {
    // Naming one that says what the blocks say changes nothing.
    expect(
      catalogueDeviations(blocks, catalogue(), { policies: ['probe.tenant_isolation'] }),
    ).toEqual([])

    // Even one that only narrows: the blocks say what the table promises.
    const application = catalogue({
      tables: {
        probe: table({
          policies: { tenant_isolation: 'RESTRICTIVE for ALL to opengewerk_app using (true)' },
        }),
      },
    })

    expect(
      catalogueDeviations(blocks, application, { policies: ['probe.tenant_isolation'] }),
    ).toEqual([
      'table probe, policy tenant_isolation: line 1: the blocks say "PERMISSIVE for ALL to opengewerk_app using (true)", the database says "RESTRICTIVE for ALL to opengewerk_app using (true)"',
    ])
  })

  it('reports a column of the blocks that says something else, whatever is named', () => {
    const application = catalogue({
      tables: { probe: table({ columns: { ...table().columns, name: 'text' } }) },
    })

    expect(catalogueDeviations(blocks, application, { columns: ['probe.name'] })).toEqual([
      'table probe, column name: line 1: the blocks say "text not null", the database says "text"',
    ])
  })

  it('reports a trigger the blocks have and the database lacks, whatever is named', () => {
    const application = catalogue({ tables: { probe: table({ triggers: {} }) } })

    expect(
      catalogueDeviations(blocks, application, { triggers: ['probe.audit_changes'] }),
    ).toContain('table probe, trigger audit_changes: missing in the database')
  })

  it("reports what is named as the application's own and is not there", () => {
    // An entry cannot outlive what it excuses, on a table of the foundation or
    // on one the foundation never had.
    expect(
      catalogueDeviations(blocks, catalogue(), {
        triggers: ['probe.long_gone', 'customers.something'],
        columns: ['probe.parcel_id'],
        constraints: ['customers.customers_pkey'],
        policies: ['probe.vanished', 'customers.within_areas'],
      }),
    ).toEqual([
      "table probe, column parcel_id: named as the application's own and not there",
      "table probe, policy vanished: named as the application's own and not there",
      "table probe, trigger long_gone: named as the application's own and not there",
      "customers.something: named as the application's own on a table the foundation does not have",
      "customers.customers_pkey: named as the application's own on a table the foundation does not have",
      "customers.within_areas: named as the application's own on a table the foundation does not have",
    ])
  })

  it('names the first line on which a function parts ways', () => {
    const application = catalogue({
      functions: {
        'probe_count()': (blocks.functions['probe_count()'] as string).replace(
          'SELECT 1',
          'SELECT 2',
        ),
      },
    })

    expect(catalogueDeviations(blocks, application)).toEqual([
      'function probe_count(): line 4: the blocks say "\\tSELECT 1", the database says "\\tSELECT 2"',
    ])
  })

  it('counts who may call a function as part of what the function is', () => {
    const application = catalogue({
      functions: {
        'probe_count()': `${blocks.functions['probe_count()'] as string}, PUBLIC`,
      },
    })

    expect(catalogueDeviations(blocks, application)).toEqual([
      'function probe_count(): line 6: the blocks say "-- may be called by: opengewerk_app", the database says "-- may be called by: opengewerk_app, PUBLIC"',
    ])
  })

  it('reports an enum that has another value, or the same ones in another order', () => {
    expect(catalogueDeviations(blocks, catalogue({ enums: { probe_kind: 'two, one' } }))).toEqual([
      'enum probe_kind: line 1: the blocks say "one, two", the database says "two, one"',
    ])
  })

  it('reports a schema the application role cannot enter', () => {
    expect(catalogueDeviations(blocks, catalogue({ schema: 'no usage' }))).toEqual([
      'schema public: the blocks say "usage", the database says "no usage"',
    ])
  })
})
