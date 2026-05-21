import { useRef } from "react";
import { Camera, X, ImagePlus } from "lucide-react";
import { ConsultFormData } from "./consultTypes";

interface Props {
  data: ConsultFormData;
  onChange: (updates: Partial<ConsultFormData>) => void;
}

export const PhotosSection = ({ data, onChange }: Props) => {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    onChange({ photos: [...data.photos, ...Array.from(files)] });
  };

  const removePhoto = (idx: number) => {
    onChange({ photos: data.photos.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[#0a1f3d]/30 text-sm font-semibold text-[#0a1f3d] bg-[#0a1f3d]/5 active:bg-[#0a1f3d]/10"
        >
          <Camera size={18} /> Take Photo
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-gray-300 text-sm font-semibold text-gray-600 bg-gray-50 active:bg-gray-100"
        >
          <ImagePlus size={18} /> Gallery
        </button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {data.photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {data.photos.map((photo, idx) => (
            <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
              <img
                src={URL.createObjectURL(photo)}
                alt={`Site photo ${idx + 1}`}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(idx)}
                className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5"
              >
                <X size={12} className="text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {data.photos.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-2">No photos yet. Capture the yard, property lines, and obstacles.</p>
      )}
    </div>
  );
};
