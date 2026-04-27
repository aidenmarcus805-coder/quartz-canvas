function joinClasses(...classes: readonly (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function Switch({
  checked,
  disabled,
  label,
  onChange
}: {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-label={label}
      aria-checked={checked}
      className={joinClasses(
        "relative h-5 w-9 rounded-full border transition-[background-color,border-color,opacity] duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-outer)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-workspace-main)]",
        checked
          ? "border-black bg-black"
          : "border-[var(--border)] bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)]",
        disabled && "cursor-default opacity-45"
      )}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={joinClasses(
          "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-transform duration-100 ease-out",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}
