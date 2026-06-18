process.env.NODE_ENV = 'test';
import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import app from '../index';
import prisma from '../config/prisma';

const PORT = 3012;
const BASE_URL = `http://localhost:${PORT}/api/v1`;

function request(
  method: 'GET' | 'POST',
  path: string,
  body?: any
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${path}`;
    const options: http.RequestOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(url, options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = responseBody ? JSON.parse(responseBody) : {};
          resolve({ status: res.statusCode || 500, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode || 500, data: { raw: responseBody } });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Emergency SMS and Ingestion Integration Test ---');

  const server = app.listen(PORT, async () => {
    console.log(`Test server running on port ${PORT}`);
    
    try {
      // 1. Cleanup and setup test tenant
      console.log('\n[1/4] Preparing test tenant clearsky-test...');
      const tenantSlug = 'clearsky-test';
      
      const oldTenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (oldTenant) {
        await prisma.telemetryEvent.deleteMany({ where: { tenantId: oldTenant.id } });
        await prisma.deviceFingerprint.deleteMany({
          where: {
            customerProfile: {
              tenantId: oldTenant.id
            }
          }
        });
        await prisma.customerProfile.deleteMany({ where: { tenantId: oldTenant.id } });
        await prisma.tenant.delete({ where: { id: oldTenant.id } });
      }

      const tenant = await prisma.tenant.create({
        data: {
          slug: tenantSlug,
          name: 'ClearSky Test Plumbing',
        },
      });
      console.log(`Created test tenant: ${tenant.slug}`);

      // 2. Ingest emergency voicemail (should trigger automated SMS response)
      console.log('\n[2/4] Ingesting simulated emergency voicemail with leak keywords...');
      const phoneNum = '+19097055234';
      const eventPayload = {
        tenantSlug,
        eventType: 'telnyx.voice.voicemail',
        provider: 'telnyx_voice',
        phone: phoneNum,
        name: 'Marie',
        payload: {
          sessionId: 'sess_test_voicemail',
          voicemail_text: 'Hello, this is Marie. We have a major water leak burst pipe in the basement, it is flooding!',
          phone: phoneNum
        },
        isTest: true
      };

      const res = await request('POST', '/telemetry/events', eventPayload);
      console.log(`Ingestion status: ${res.status}`);
      if (res.status !== 201) {
        throw new Error(`Expected status 201, got ${res.status}. Response: ${JSON.stringify(res.data)}`);
      }

      const pipelineLogs = res.data.pipeline_log || [];
      console.log('Pipeline Logs:');
      pipelineLogs.forEach((l: string) => console.log(`  ${l}`));

      // 3. Verify trace logs contain SMS trigger log
      console.log('\n[3/4] Verifying pipeline logs for SMS dispatch entry...');
      const smsLog = pipelineLogs.find((l: string) => l.includes('[SMS]') && l.includes('Triggering automated emergency response SMS'));
      if (!smsLog) {
        throw new Error('Pipeline logs missing the automated SMS callback entry');
      }
      console.log(`✓ Found SMS pipeline log: ${smsLog}`);

      // 4. Verify the database recorded the sms_sent event
      console.log('\n[4/4] Verifying sms_sent event has been recorded in database...');
      // Wait briefly for the async database write to complete
      await new Promise((r) => setTimeout(r, 500));

      const dbSmsEvents = await prisma.telemetryEvent.findMany({
        where: {
          tenantId: tenant.id,
          eventType: 'sms_sent'
        }
      });

      console.log(`Database sms_sent events count: ${dbSmsEvents.length}`);
      if (dbSmsEvents.length === 0) {
        throw new Error('No sms_sent event recorded in the database');
      }

      const smsEvent = dbSmsEvents[0];
      const ep = smsEvent.payload as any;
      console.log('Recorded SMS Event payload:', ep);

      if (!ep.body.includes('main water supply immediately') || !ep.to.includes('19097055234')) {
        throw new Error('The recorded SMS event advice text or phone target is incorrect');
      }
      console.log('✓ Verified sms_sent event body contains water leak advice text.');

      console.log('\n*** All Emergency SMS Integration Tests Passed Successfully! ***\n');
      process.exit(0);
    } catch (e: any) {
      console.error('\n!!! Integration Test Failed !!!');
      console.error(e.message);
      process.exit(1);
    } finally {
      server.close();
    }
  });
}

runTests();
