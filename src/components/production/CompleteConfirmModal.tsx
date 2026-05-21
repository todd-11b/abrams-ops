interface Props { onCancel: () => void; onConfirm: () => Promise<void>; }

export function CompleteConfirmModal({ onCancel, onConfirm }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md p-5 space-y-4">
        <h2 className="font-semibold text-lg">Mark this job complete?</h2>
        <p className="text-sm text-slate-600">
          This moves the GHL opportunity to <strong>Job Complete</strong> and triggers the review request workflow.
          You cannot undo this from the field view.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-2 text-slate-600">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-emerald-700 text-white rounded">Mark complete</button>
        </div>
      </div>
    </div>
  );
}
