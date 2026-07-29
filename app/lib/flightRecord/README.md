# FlightRecord

`FlightRecord` is the immutable, versioned archive of one completed flight.
It is a domain model only: no UI, storage, API, import/export, or replay is
connected to it.

## Authorized inputs

`FlightRecordBuilder` accepts exactly:

1. `FlightSession`
2. `FlightFacts`
3. `FlightTimeline`
4. `Observation[]`

It rejects incomplete flights, missing identities, missing end times, and
source identity mismatches.

## Pipeline

1. Validate that the four sources describe one completed flight.
2. Deep-clone the source graph.
3. Build identity, metadata, empty extension domains, and source counts.
4. Generate a deterministic non-cryptographic integrity fingerprint.
5. Recursively freeze the complete record.

No timestamp is generated from the system clock. `archivedAt` and
`signature.generatedAt` come from the completed flight sources.

## Absent domains

The current `FlightSession` has no verified aircraft, crew, media, or notes
source. The builder therefore emits:

- `FlightAircraft.status = "UNAVAILABLE"`
- `FlightCrew.status = "UNAVAILABLE"`
- empty media and note collections

It never invents registrations, crew names, or content.

## Signature

`FlightSignature` uses `BC-FNV1A-32` over a canonical representation of the
four sources. It detects accidental changes and supports deterministic tests.
It is explicitly not cryptographic and has no legal-signature meaning.

## Versioning

- `FlightRecord.metadata.schemaVersion` versions the archive contract.
- `sourceVersions` records the version expected from each input family.
- New optional domains can be introduced in later schema versions without
  changing historical records.
