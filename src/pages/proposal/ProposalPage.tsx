import { useParams } from 'react-router-dom';

export default function ProposalPage() {
  const { contactId } = useParams<{ contactId: string }>();
  return (
    <div className="min-h-screen bg-white p-8">
      <h1 className="text-2xl font-semibold text-primary">Proposal</h1>
      <p className="mt-2 text-gray-600">Contact ID: {contactId}</p>
      <p className="mt-2 text-gray-600">Awaiting migration of proposal files from GHL AI Studio.</p>
    </div>
  );
}
