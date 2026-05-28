import { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  /** Render the (possibly mid-tween) numeric value to a string. */
  format?: (value: number) => string;
  className?: string;
  /** Tween duration in ms. */
  duration?: number;
}

// Only animate when we can positively confirm motion is allowed. When matchMedia
// is unavailable (jsdom/SSR) or reduce is preferred, snap straight to the value —
// keeping tests deterministic and respecting the user's motion preference.
const canAnimate = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Tweens the displayed value (easeOutCubic) whenever `value` changes and flashes
 * a tint — green up / red down. Used anywhere a live count updates so the change
 * reads as motion rather than a silent jump. Honors prefers-reduced-motion by
 * snapping straight to the new value with no tween or flash.
 */
export function AnimatedNumber({
  value,
  format = (input) => Math.round(input).toLocaleString(),
  className = "",
  duration = 700,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  // True only while the value is mid-tween. Used to clamp the formatted output to
  // at most one decimal place during the animation so the digits don't jitter; the
  // settled value keeps its normal formatting.
  const [tweening, setTweening] = useState(false);
  const fromRef = useRef(value);
  const prevRef = useRef(value);
  const rafRef = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (value === prevRef.current) {
      return;
    }

    const direction = value >= prevRef.current ? "up" : "down";
    prevRef.current = value;

    if (!canAnimate()) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const from = fromRef.current;
    const start = performance.now();
    setFlash(direction);
    setTweening(true);
    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (value - from) * eased;
      fromRef.current = current;
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
        setDisplay(value);
        setTweening(false);
        flashTimerRef.current = setTimeout(() => setFlash(null), 350);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    },
    [],
  );

  // While tweening, keep the animated digits calm: abbreviated values (with a
  // magnitude suffix like "184.37K") keep at most one decimal → "184.3K"; values
  // shown in full ("1,234.5") drop the fraction entirely → "1,234". The settled
  // value always renders the full format.
  const formatted = format(display);
  const abbreviated = /[a-z]/i.test(formatted);
  const text = tweening
    ? abbreviated
      ? formatted.replace(/(\.\d)\d+/g, "$1")
      : formatted.replace(/\.\d+/g, "")
    : formatted;

  return (
    <span className={`anim-num ${flash ? `flash-${flash}` : ""} ${className}`.trim()}>{text}</span>
  );
}
