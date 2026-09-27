interface StoryBeatInputProps {
  label: string;
  description: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  accentHex: string;
}

export function StoryBeatInput({ label, description, placeholder, value, onChange, accentHex }: StoryBeatInputProps) {
  return (
    <div className="group">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.1em]" style={{ color: accentHex }}>
          {label}
        </span>
      </div>
      <div className="text-[9px] text-[#5a616c] mb-2 leading-snug">{description}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full px-2.5 py-2 rounded-[5px] bg-[#0a0a0d] border border-white/[0.08] text-[12px] leading-[1.5] text-[#c9ccd1] outline-none focus:border-white/25 focus:bg-[#08080a] resize-none transition-all placeholder:text-[#3f444d]"
        placeholder={placeholder}
      />
    </div>
  );
}
