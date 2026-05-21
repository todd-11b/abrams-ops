import { useParams } from 'react-router-dom';

export default function ProductionJob() {
  const { jobId } = useParams<{ jobId: string }>();
  return (
    <div className="min-h-screen bg-white p-8">
      <h1 className="text-2xl font-semibold text-primary">Job {jobId}</h1>
      <p className="mt-2 text-gray-600">Field view — to be built after consult migration is complete.</p>
    </div>
  );
}
