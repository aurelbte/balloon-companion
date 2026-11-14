import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createR2Client, diagnoseR2, formatR2Error, main, readConfig, runRemote } from './publish-osm-r2.mjs';

// Synthetic credentials only. The SDK's HTTP transport is fully replaced: no network or PUT.
const env = { R2_ACCOUNT_ID: '0'.repeat(32), R2_ACCESS_KEY_ID: 'synthetic-access-id',
  R2_SECRET_ACCESS_KEY: 'synthetic-secret+/=', R2_BUCKET_OSM_POWER_LINES: 'balloon-companion-osm',
  R2_OSM_PUBLIC_BASE_URL: 'https://pub-synthetic.r2.dev', R2_OSM_CORS_ORIGINS: 'https://www.balloon-companion.com' };
const xmlEscape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const plan = { dataset: 'belgium', version: '20261108-db4ecb06f9ec03a1',
  manifest: { country_profile: { code: 'BE' } }, items: [{ key: 'tiles/11/1037/682.geojson' }] };
const cors = '<CORSConfiguration><CORSRule><AllowedOrigin>https://www.balloon-companion.com</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod></CORSRule></CORSConfiguration>';

test('R2 400 diagnostics: actual SDK signing/encoding, operation, Cloudflare detail, and secret redaction (offline)', async () => {
  const config = readConfig(env);
  for (const failedOperation of ['HeadBucket', 'GetBucketCors', 'HeadObject']) {
    const captured = [];
    const requestHandler = { destroy() {}, async handle(request) {
      assert.ok(['HEAD', 'GET'].includes(request.method), 'Only read-only requests are allowed');
      captured.push(request);
      const operation = request.method === 'GET' ? 'GetBucketCors' : request.path === '/' ? 'HeadBucket' : 'HeadObject';
      const failed = operation === failedOperation;
      const detail = `Invalid header encoding; ${env.R2_ACCESS_KEY_ID} ${env.R2_SECRET_ACCESS_KEY} ${encodeURIComponent(env.R2_SECRET_ACCESS_KEY)}\nAuthorization: AWS4-HMAC-SHA256 Credential=unlisted-access-id/20261113/auto/s3/aws4_request, Signature=unlisted-signature`;
      const body = failed ? operation === 'GetBucketCors' ? `<Error><Code>InvalidArgument</Code><Message>${xmlEscape(detail)}</Message></Error>` : '' : request.method === 'GET' ? cors : '';
      return { response: { statusCode: failed ? 400 : 200,
        headers: { 'content-type': 'application/xml', 'x-amz-request-id': 'synthetic-request-id', 'cf-ray': 'synthetic-ray' },
        body: Readable.from([Buffer.from(body)]) } };
    } };
    const client = createR2Client(config, { requestHandler, maxAttempts: 1 });
    try {
      const error = await runRemote(plan, config, { client }).then(() => assert.fail('Expected diagnostic failure'), error => error);
      const output = formatR2Error(error, {}); // Redaction also uses the private request context, not just process.env.
      assert.match(output, /R2_REQUEST_FAILED_400_/);
      const parsed = JSON.parse(output.slice(output.indexOf('{')));
      assert.equal(parsed.operation, failedOperation);
      assert.equal(parsed.requestId, 'synthetic-request-id'); assert.equal(parsed.cfRay, 'synthetic-ray');
      if (failedOperation === 'GetBucketCors') {
        assert.equal(parsed.code, 'InvalidArgument'); assert.match(parsed.detail, /Invalid header encoding/);
      } else {
        assert.equal(error.name, 'Unknown', 'Reproduce the SDK empty HEAD 400');
        assert.match(parsed.detail, /HEAD peut être sans corps/);
      }
      for (const secret of [env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, encodeURIComponent(env.R2_SECRET_ACCESS_KEY), 'unlisted-access-id', 'unlisted-signature']) assert.ok(!output.includes(secret));
      for (const request of captured) {
        assert.equal(request.protocol, 'https:');
        assert.equal(request.hostname, `balloon-companion-osm.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
        assert.equal(request.headers.host, request.hostname);
        assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 Credential=/);
        assert.match(request.headers.authorization, /\/auto\/s3\/aws4_request/);
        assert.match(request.headers.authorization, /SignedHeaders=[^,]*host/);
        assert.match(request.headers['x-amz-date'], /^\d{8}T\d{6}Z$/);
        assert.equal(request.headers['x-amz-content-sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        assert.equal(request.headers['content-encoding'], undefined);
        assert.equal(request.headers['x-amz-sdk-checksum-algorithm'], undefined);
        if (request.method === 'GET') assert.equal(request.query.cors, '');
        if (request.path !== '/') assert.equal(request.path, `/osm-power-lines/belgium/${plan.version}/tiles/11/1037/682.geojson`);
      }
    } finally { client.destroy(); }
  }
  // Parser-error responses can expose selected XML/JSON fields, never a full response/request.
  const opaque = Object.assign(new Error('Unknown'), { name: 'Unknown', Code: 'Unknown', Message: 'Unknown', $metadata: { httpStatusCode: 400 },
    $responseBodyText: `<Error><Code>InvalidDigest</Code><Message>Malformed checksum ${xmlEscape(env.R2_SECRET_ACCESS_KEY)}</Message><CanonicalRequest>NEVER_DUMP_THIS</CanonicalRequest></Error>`,
    request: { authorization: 'NEVER_DUMP_THIS' } });
  let output = formatR2Error(opaque, env);
  assert.match(output, /InvalidDigest/); assert.match(output, /Malformed checksum/);
  assert.ok(!output.includes(env.R2_SECRET_ACCESS_KEY)); assert.ok(!output.includes('NEVER_DUMP_THIS'));
  opaque.$responseBodyText = JSON.stringify({ errors: [{ code: 10014, message: `Malformed checksum ${Buffer.from(env.R2_SECRET_ACCESS_KEY).toString('base64')}` }] });
  output = formatR2Error(opaque, env);
  assert.match(output, /10014/); assert.ok(!output.includes(Buffer.from(env.R2_SECRET_ACCESS_KEY).toString('base64')));
  assert.throws(() => readConfig({ ...env, R2_ENDPOINT: 'https://pub-synthetic.r2.dev' }), /INVALID_R2_ENDPOINT/);
  assert.throws(() => readConfig({ ...env, R2_ENDPOINT: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/balloon-companion-osm` }), /INVALID_R2_ENDPOINT/);
});


test('read-only ListObjectsV2 diagnostic gives XML detail and never bypasses publication controls', async () => {
  const config = readConfig(env);
  assert.equal(config.credentials.accessKeyId, env.R2_ACCESS_KEY_ID);
  assert.equal(config.credentials.secretAccessKey, env.R2_SECRET_ACCESS_KEY);
  for (const key of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    assert.throws(() => readConfig({ ...env, [key]: env[key] + '\n' }), /INVALID_S3_CREDENTIAL_WHITESPACE/);
  }
  await assert.rejects(main(['--source', '/not-read', '--diagnose', '--publish']), /CONFLICTING_MODES/);
  for (const success of [false, true]) {
    const calls = [];
    const client = createR2Client(config, { maxAttempts: 1, requestHandler: { destroy() {}, async handle(request) {
      calls.push(request.method);
      assert.ok(['HEAD', 'GET'].includes(request.method), 'No write operation is permitted');
      const listing = request.method === 'GET';
      if (listing) {
        assert.equal(request.query['list-type'], '2'); assert.equal(String(request.query['max-keys']), '1');
        assert.equal(request.query.prefix, `osm-power-lines/belgium/${plan.version}/`);
        assert.match(request.headers.authorization, /\/auto\/s3\/aws4_request/);
      }
      const body = !listing ? '' : success
        ? '<ListBucketResult><IsTruncated>false</IsTruncated><KeyCount>1</KeyCount><Contents><Key>DO_NOT_LOG_THIS_KEY</Key></Contents></ListBucketResult>'
        : `<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature does not match ${xmlEscape(env.R2_SECRET_ACCESS_KEY)}</Message></Error>`;
      return { response: { statusCode: !listing ? 400 : success ? 200 : 403,
        headers: { 'content-type': 'application/xml', 'cf-ray': 'synthetic-ray' }, body: Readable.from([Buffer.from(body)]) } };
    } } });
    try {
      // Original HEAD gate must still stop both check and publish.
      await assert.rejects(runRemote(plan, config, { client }), error => error.name === 'Unknown');
      if (success) {
        const result = await diagnoseR2(plan, config, { client });
        assert.equal(result.listAccessVerified, true); assert.equal(result.writeAccessVerified, null);
        assert.equal(result.publicationPreflightPassed, null);
        assert.equal(result.writeAccessStatus, 'NOT_TESTED'); assert.equal(result.publicationPreflightStatus, 'NOT_RUN');
        assert.match(result.explanation, /No write request or publication preflight was performed/);
        assert.ok(!JSON.stringify(result).includes('DO_NOT_LOG_THIS_KEY'));
      } else {
        await assert.rejects(diagnoseR2(plan, config, { client }), error => {
          const output = formatR2Error(error, {});
          assert.match(output, /ListObjectsV2/); assert.match(output, /SignatureDoesNotMatch/);
          assert.match(output, /The request signature does not match/); assert.ok(!output.includes(env.R2_SECRET_ACCESS_KEY));
          return true;
        });
      }
      await assert.rejects(runRemote(plan, config, { client, publish: true }), error => error.name === 'Unknown');
      assert.deepEqual(calls, ['HEAD', 'GET', 'HEAD']);
    } finally { client.destroy(); }
  }
});
