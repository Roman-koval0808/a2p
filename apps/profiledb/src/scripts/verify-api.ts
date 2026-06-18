process.env.NODE_ENV = 'test';
import dotenv from 'dotenv';
dotenv.config();
console.log('ACTIVE DATABASE URL:', process.env.DATABASE_URL);

import http from 'http';
import app from '../index';
import prisma from '../config/prisma';
import crypto from 'crypto';

const PORT = 3009;
const BASE_URL = `http://localhost:${PORT}/api/v1`;

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

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
  console.log('--- Starting Integration Tests ---');

  // Start Express Server
  const server = app.listen(PORT, async () => {
    console.log(`Test server running on port ${PORT}`);
    
    try {
      // 1. Database Cleanup and Setup
      console.log('\n[1/7] Cleaning database & preparing test tenant...');
      await prisma.telemetryEvent.deleteMany({});
      await prisma.deviceFingerprint.deleteMany({});
      await prisma.customerProfile.deleteMany({});
      await prisma.tenant.deleteMany({});

      const tenant = await prisma.tenant.create({
        data: {
          slug: 'test-tenant',
          name: 'Test Plumbing Corp',
        },
      });
      console.log(`Created test tenant: ${tenant.slug}`);

      // 2. Ingest Anonymous Event (Scenario 1: Creates profile and links fingerprint)
      console.log('\n[2/7] Testing Anonymous Ingestion...');
      const payload1 = {
        tenantSlug: 'test-tenant',
        fingerprintId: 'fp_user_1',
        eventType: 'clearsky.web.view',
        pageUrl: '/home',
        scoreDelta: 10,
        payload: { ref: 'google' },
        isTest: true
      };

      const res1 = await request('POST', '/telemetry/events', payload1);
      console.log(`Status: ${res1.status}`);
      if (res1.status !== 201) throw new Error('Failed anonymous ingestion');
      
      const p1 = res1.data.profile;
      console.log('Anonymous Profile Created:', p1);
      if (p1.scoreRaw !== 10 || p1.intentBucket !== 'research') {
        throw new Error('Anonymous scoring / intent mapping failed');
      }

      // 3. Ingest second event (increases score on same profile)
      console.log('\n[3/7] Ingesting second event for same anonymous user...');
      const payload2 = {
        tenantSlug: 'test-tenant',
        fingerprintId: 'fp_user_1',
        eventType: 'clearsky.web.click',
        pageUrl: '/pricing',
        scoreDelta: 25, // score 10 + 25 = 35
        isTest: true
      };

      const res2 = await request('POST', '/telemetry/events', payload2);
      if (res2.status !== 201) throw new Error('Failed second ingestion');
      const p2 = res2.data.profile;
      console.log('Profile score updated:', p2);
      if (p2.scoreRaw !== 35 || p2.intentBucket !== 'comparison') {
        throw new Error('Scoring progression failed');
      }

      // 4. Submit Identity (Scenario A: New Identity -> Updates profile)
      console.log('\n[4/7] Submitting email to establish new identity...');
      const payload3 = {
        tenantSlug: 'test-tenant',
        fingerprintId: 'fp_user_1',
        eventType: 'form_submit',
        email: 'john@doe.com',
        name: 'John Doe',
        scoreDelta: 30, // score 35 + 20 (from form_submit in registry) = 55
        isTest: true
      };

      const res3 = await request('POST', '/telemetry/events', payload3);
      const p3 = res3.data.profile;
      console.log('Profile updated to known:', p3);
      const expectedEmailHash = sha256('john@doe.com');
      if (p3.email !== expectedEmailHash || p3.name !== 'John Doe' || p3.scoreRaw !== 55 || p3.intentBucket !== 'active') {
        throw new Error(`Identity submission scenario A failed. Got email: ${p3.email}, scoreRaw: ${p3.scoreRaw}, intentBucket: ${p3.intentBucket}`);
      }

      // 5. Ingestion with new fingerprint but same email (Scenario B: Merge fingerprint and history)
      console.log('\n[5/7] Testing Scenario B: New anonymous session merging into existing email identity...');
      // Step A: Create another anonymous user on new fingerprint
      const resTemp = await request('POST', '/telemetry/events', {
        tenantSlug: 'test-tenant',
        fingerprintId: 'fp_user_2',
        eventType: 'clearsky.web.view',
        scoreDelta: 5,
        isTest: true
      });
      const tempProfileId = resTemp.data.profile.id;
      console.log('Created temporary anonymous profile:', tempProfileId);

      // Step B: Submit event with new fingerprint but matching email 'john@doe.com'
      const resMerge = await request('POST', '/telemetry/events', {
        tenantSlug: 'test-tenant',
        fingerprintId: 'fp_user_2',
        eventType: 'clearsky.web.click',
        email: 'john@doe.com',
        scoreDelta: 10,
        isTest: true
      });
      
      const mergedProfile = resMerge.data.profile;
      console.log('Merged Profile:', mergedProfile);
      
      // The score should be: John's score (55) + temp profile score (5) + new event score (0 from clearsky.web.click if not in registry, wait, clearsky.web.click is 0 in registry unless it defaults)
      // Actually, since clearsky.web.click is not in registry, it defaults to clientScoreDelta (10)
      // So score should be: 55 + 5 + 10 = 70
      if (mergedProfile.id !== p3.id || mergedProfile.scoreRaw !== 70) {
        throw new Error(`Profile merge failed. Expected id: ${p3.id}, score: 70. Got id: ${mergedProfile.id}, score: ${mergedProfile.scoreRaw}`);
      }

      // Verify historical events count
      const historyRes = await request('GET', `/tenants/test-tenant/profiles/${p3.id}/history`);
      console.log('Re-linked history events count:', historyRes.data.length);
      if (historyRes.data.length !== 5) {
        throw new Error(`Expected 5 total events linked to profile. Got ${historyRes.data.length}`);
      }

      // Check if temp profile was deleted
      const checkTemp = await prisma.customerProfile.findUnique({
        where: { id: tempProfileId },
      });
      if (checkTemp) {
        throw new Error('Temporary anonymous profile was not deleted after merge');
      }

      // 6. Test conflict resolution: email matches Profile A, phone matches Profile B. Merge phone profile into email profile.
      console.log('\n[6/7] Testing identifier conflict (email matches Profile A, phone matches Profile B)...');
      
      // Step A: Create Profile B with phone
      const resPhoneProfile = await request('POST', '/telemetry/events', {
        tenantSlug: 'test-tenant',
        fingerprintId: 'fp_user_phone_only',
        eventType: 'clearsky.web.view',
        phone: '+15551234',
        name: 'Phone User',
        scoreDelta: 15,
        isTest: true
      });
      const profileB = resPhoneProfile.data.profile;
      console.log('Created Profile B (phone-only):', profileB);

      // Step B: Send event with both email (Profile A) and phone (Profile B) on a third fingerprint
      const resConflict = await request('POST', '/telemetry/events', {
        tenantSlug: 'test-tenant',
        fingerprintId: 'fp_user_conflict',
        eventType: 'clearsky.web.click',
        email: 'john@doe.com',
        phone: '+15551234',
        scoreDelta: 5,
        isTest: true
      });
      const finalConflictProfile = resConflict.data.profile;
      console.log('Conflict Resolution Profile:', finalConflictProfile);

      // finalConflictProfile should be Profile A (john@doe.com).
      // The score should be: Profile A score (70) + Profile B score (15) + new event score (5) = 90.
      if (finalConflictProfile.id !== p3.id || finalConflictProfile.scoreRaw !== 90) {
        throw new Error(`Conflict merge failed. Expected id: ${p3.id}, score: 90. Got id: ${finalConflictProfile.id}, score: ${finalConflictProfile.scoreRaw}`);
      }
      
      // Verify Profile B was deleted
      const checkProfileB = await prisma.customerProfile.findUnique({
        where: { id: profileB.id },
      });
      if (checkProfileB) {
        throw new Error('Phone-matched profile was not deleted during conflict resolution');
      }

      // 7. Testing Profile Querying & Admin Analytics Aggregation
      console.log('\n[7/7] Testing Query and Analytics endpoints...');
      const profilesRes = await request('GET', `/tenants/test-tenant/profiles?search=John`);
      if (profilesRes.data.data.length !== 1 || profilesRes.data.data[0].id !== p3.id) {
        throw new Error('Search profiles failed');
      }

      const analyticsRes = await request('GET', '/analytics/aggregation');
      console.log('Analytics response summary:', analyticsRes.data.summary);
      console.log('Intent distribution:', analyticsRes.data.intentBucketsDistribution);
      if (analyticsRes.data.summary.totalProfiles !== 1) {
        throw new Error('Analytics aggregation total profile count mismatch');
      }

      console.log('\n*** All Integration Tests Passed Successfully! ***\n');
      process.exit(0);
    } catch (e: any) {
      console.error('\n!!! Test Execution Failed !!!');
      console.error(e.message);
      process.exit(1);
    } finally {
      server.close();
    }
  });
}

runTests();
