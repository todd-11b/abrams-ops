import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ProposalView } from '../../components/consult/ProposalView';
import { SignPayView } from '../../components/consult/SignPayView';
import { calcTotals, ConsultFormData } from '../../components/consult/consultTypes';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; form: ConsultFormData };

export default function ProposalPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setState({ status: 'error', message: 'Missing proposal token in URL.' });
        return;
      }
      try {
        const res = await fetch(`/api/proposal/${encodeURIComponent(token)}`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg =
            res.status === 404
              ? 'This proposal is not available. The link may have expired or the proposal hasn’t been finalized yet.'
              : body?.error || `Could not load proposal (${res.status}).`;
          if (!cancelled) setState({ status: 'error', message: msg });
          return;
        }
        const { form } = await res.json();
        if (!cancelled) setState({ status: 'ready', form });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Network error.',
          });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-gray-500 text-sm">Loading proposal…</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-primary mb-2">Proposal unavailable</h1>
          <p className="text-gray-600 text-sm">{state.message}</p>
        </div>
      </div>
    );
  }

  const totals = calcTotals(state.form);

  if (signing && token) {
    return <SignPayView form={state.form} proposalId={state.form.proposalId} proposalToken={token} onBack={() => setSigning(false)} />;
  }

  return (
    <ProposalView
      form={state.form}
      totals={totals}
      onBack={() => {
        /* customer-facing — no back action */
      }}
      onPresent={() => setSigning(true)}
      onSendForReview={() => {
        /* customer-facing — no send action */
      }}
      sending={false}
      sent={false}
      isPublic={true}
    />
  );
}
