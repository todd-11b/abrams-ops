import { useMemo, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useJob } from '../../hooks/useJob';
import { useChecklist } from '../../hooks/useChecklist';
import { JobHeader } from '../../components/production/JobHeader';
import { ChecklistSection } from '../../components/production/ChecklistSection';
import { FlagIssueModal } from '../../components/production/FlagIssueModal';
import { BlockedModal } from '../../components/production/BlockedModal';
import { CompleteConfirmModal } from '../../components/production/CompleteConfirmModal';
import { PhotoUpload } from '../../components/production/PhotoUpload';
import { CHECKLIST_TEMPLATE } from '../../utils/checklistTemplate';
import { supabase } from '../../lib/supabase';
import { crmApi } from '../../lib/crm-api';
import type {
  ChecklistSectionKey,
  PhotoPhase,
  JobPhoto,
} from '../../types/production';

export default function ProductionJob() {
  const { jobId } = useParams<{ jobId: string }>();
  const { job, spec, loading, setStage, block, checkBlockNotification } = useJob(jobId);
  const { items, allDone, toggle, skip } = useChecklist(jobId);

  const [issueOpen, setIssueOpen] = useState(false);
  const [issueSection, setIssueSection] = useState<ChecklistSectionKey | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [photosByPhase, setPhotosByPhase] = useState<Record<string, boolean>>({});
  const [contactCard, setContactCard] = useState<{ name: string; address: string }>({
    name: '…',
    address: '…',
  });

  useEffect(() => {
    if (!job) return;
    void crmApi
      .getContact(job.contact_id)
      .then((resp) => {
        const c = (resp as { contact?: { firstName?: string; lastName?: string; address1?: string } }).contact ?? {};
        setContactCard({
          name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || '(no name)',
          address: c.address1 || '(no address)',
        });
      })
      .catch((err) => {
        console.error('[ProductionJob] getContact failed:', err);
        setContactCard({ name: '(name unavailable)', address: '(address unavailable)' });
      });
  }, [job]);

  useEffect(() => { if (job) void checkBlockNotification(); }, [job, checkBlockNotification]);

  useEffect(() => {
    if (!jobId) return;
    void supabase
      .from('job_photos')
      .select('phase')
      .eq('job_id', jobId)
      .then((res) => {
        const map: Record<string, boolean> = {};
        for (const r of (res.data ?? []) as Pick<JobPhoto, 'phase'>[]) map[r.phase] = true;
        setPhotosByPhase(map);
      });
  }, [jobId]);

  const sections = useMemo(() => {
    const out: Record<ChecklistSectionKey, typeof items> = {
      loadout: [], onsite: [], install: [], clean: [], walkthrough: [],
    };
    for (const it of items) out[it.section].push(it);
    return out;
  }, [items]);

  if (loading || !job || !jobId) return <div className="p-6">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <JobHeader job={job} spec={spec} customerName={contactCard.name} address={contactCard.address} />

      <button
        onClick={() => { setIssueSection(null); setIssueOpen(true); }}
        className="fixed top-3 right-3 z-20 bg-rose-600 text-white px-3 py-2 rounded-lg shadow-md text-sm"
      >🚩 Flag Issue</button>

      <main className="p-3 space-y-3">
        {CHECKLIST_TEMPLATE.map((sec) => (
          <ChecklistSection
            key={sec.section}
            title={sec.title}
            photoDescription={sec.photo_description}
            items={sections[sec.section]}
            photoUploaded={!!photosByPhase[sec.section]}
            onToggle={toggle}
            onSkip={skip}
            onFlagIssueHere={() => { setIssueSection(sec.section); setIssueOpen(true); }}
            photoUploadSlot={
              sec.photo_description ? (
                <PhotoUpload
                  jobId={jobId}
                  contactId={job.contact_id}
                  phase={sec.section as PhotoPhase}
                  onUploaded={() => setPhotosByPhase((p) => ({ ...p, [sec.section]: true }))}
                />
              ) : null
            }
          />
        ))}

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            onClick={() => setBlockOpen(true)}
            className="px-4 py-3 border border-amber-500 text-amber-700 rounded-lg"
          >Block Job</button>
          <button
            disabled={!allDone}
            onClick={() => setCompleteOpen(true)}
            className="px-4 py-3 bg-emerald-700 text-white rounded-lg disabled:opacity-50"
          >Mark Job Complete</button>
        </div>
      </main>

      {issueOpen && (
        <FlagIssueModal
          jobId={jobId}
          contactId={job.contact_id}
          jobNumber={job.job_number}
          section={issueSection}
          onClose={() => setIssueOpen(false)}
        />
      )}
      {blockOpen && (
        <BlockedModal
          onClose={() => setBlockOpen(false)}
          onBlock={(reason, note) => block(reason, note)}
        />
      )}
      {completeOpen && (
        <CompleteConfirmModal
          onCancel={() => setCompleteOpen(false)}
          onConfirm={async () => { await setStage('job_complete'); setCompleteOpen(false); }}
        />
      )}
    </div>
  );
}
