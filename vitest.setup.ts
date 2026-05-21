// vitest.setup.ts
// Set up test env vars before test files import modules that validate env
import.meta.env.VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID = 'test-pipeline';
import.meta.env.VITE_GHL_STAGE_JOB_CREATED = 'test-stage-jc';
import.meta.env.VITE_GHL_STAGE_SCHEDULED = 'test-stage-sched';
import.meta.env.VITE_GHL_STAGE_IN_INSTALL = 'test-stage-install';
import.meta.env.VITE_GHL_STAGE_JOB_COMPLETE = 'test-stage-complete';
import.meta.env.VITE_GHL_TODD_CONTACT_ID = 'TestContactId12345678';
