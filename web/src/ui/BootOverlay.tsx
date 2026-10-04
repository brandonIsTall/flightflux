// The HTML half of the Thermal Boot: the opening sweep line and the status line with its
// split-flap counter. The globe, dots, pings and routes animate in WebGL (globe/BootLayer).

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useBoot } from "../boot";
import { scaleGradientCss } from "../lib/color";

export function BootOverlay() {
  const phase = useBoot((s) => s.phase);
  const label = useBoot((s) => s.label);
  const count = useBoot((s) => s.count);
  const readout = useBoot((s) => s.readout);
  const notice = useBoot((s) => s.notice);
  const reduced = useBoot((s) => s.reduced);
  const skip = useBoot((s) => s.skip);
  const [skippable, setSkippable] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setSkippable(true), 1000);
    return () => window.clearTimeout(id);
  }, []);

  // Any click or key after the first second skips to the end.
  useEffect(() => {
    if (!skippable || phase !== "booting") return;
    const onAny = () => skip();
    window.addEventListener("pointerdown", onAny);
    window.addEventListener("keydown", onAny);
    return () => {
      window.removeEventListener("pointerdown", onAny);
      window.removeEventListener("keydown", onAny);
    };
  }, [skippable, phase, skip]);

  if (reduced) return <ReducedBoot phase={phase} label={label} />;

  return (
    <AnimatePresence>
      {phase !== "done" && (
        <motion.div
          key="boot"
          className="pointer-events-none absolute inset-0 z-20"
          exit={{ opacity: 0, transition: { duration: 0.6 } }}
          aria-live="polite"
          role="status"
        >
          <Sweep />
          <div className="absolute bottom-10 left-4 flex items-baseline gap-3 sm:left-6">
            <AnimatePresence mode="wait">
              {phase === "handoff" ? (
                <motion.span
                  key="wordmark"
                  className="text-[15px] font-medium tracking-tight text-ink-1"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                  Flight Flux
                </motion.span>
              ) : (
                label && (
                  <motion.span
                    key={label}
                    className="num text-[12px] text-ink-2"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.25 }}
                  >
                    {label}
                  </motion.span>
                )
              )}
            </AnimatePresence>
            {phase === "booting" && count !== null && <SplitFlap value={count} />}
            {phase === "booting" && readout && (
              <AnimatePresence mode="wait">
                <motion.span
                  key={readout}
                  className="num text-[12px] text-ink-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {readout}
                </motion.span>
              </AnimatePresence>
            )}
          </div>
          {notice && <p className="num absolute bottom-5 left-4 text-[11px] text-ink-3 sm:left-6">{notice}</p>}
          {skippable && phase === "booting" && (
            <p className="absolute right-4 bottom-5 text-[11px] text-ink-3 sm:right-6">Click or press any key to skip</p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A 2 px line in the temperature scale crossing the screen, then settling at the equator. */
function Sweep() {
  return (
    <motion.div
      className="absolute left-0 h-0.5 w-full origin-left"
      style={{ background: scaleGradientCss(), top: "50%" }}
      initial={{ scaleX: 0, opacity: 1 }}
      animate={{ scaleX: [0, 1, 1], opacity: [1, 1, 0] }}
      transition={{ duration: 1.4, times: [0, 0.55, 1], ease: "easeInOut" }}
    />
  );
}

/** Digits that roll up to the value, departures-board style. */
function SplitFlap({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const target = useRef(value);
  target.current = value;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setShown((s) => {
        const d = target.current - s;
        if (d === 0) return s;
        return s + Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) * 0.12));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className="num text-[12px] tabular-nums text-ink-1" aria-hidden>
      {shown.toLocaleString()}
    </span>
  );
}

function ReducedBoot({ phase, label }: { phase: string; label: string }) {
  if (phase === "done") return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20" role="status" aria-live="polite">
      <div className="absolute inset-x-6 bottom-10 h-px bg-hairline">
        <div className="h-px bg-ink-1 transition-[width] duration-500" style={{ width: label === "" ? "10%" : "60%" }} />
      </div>
      <span className="num absolute bottom-5 left-6 text-[12px] text-ink-2">{label || "Loading"}</span>
    </div>
  );
}
