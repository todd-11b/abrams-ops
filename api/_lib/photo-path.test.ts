import { describe, expect, it } from 'vitest';
import { isJobPhotoPath } from './photo-path';

const jobId = '11111111-2222-3333-4444-555555555555';
const file = '1717171717_66666666-7777-8888-9999-aaaaaaaaaaaa.jpg';

describe('job photo object keys', () => {
  it('accepts every phase the app uploads', () => {
    for (const phase of ['loadout', 'onsite', 'install', 'clean', 'issue']) {
      expect(isJobPhotoPath(`${jobId}/${phase}/${file}`)).toBe(true);
    }
  });

  it('rejects traversal, absolute keys and phases outside the client contract', () => {
    expect(isJobPhotoPath(`${jobId}/onsite/../../other/${file}`)).toBe(false);
    expect(isJobPhotoPath(`/${jobId}/onsite/${file}`)).toBe(false);
    expect(isJobPhotoPath(`${jobId}/before/${file}`)).toBe(false);
    expect(isJobPhotoPath(`${jobId}/onsite/${file}/../../../secret.jpg`)).toBe(false);
    expect(isJobPhotoPath(`not-a-job/onsite/${file}`)).toBe(false);
    expect(isJobPhotoPath(42)).toBe(false);
  });
});
