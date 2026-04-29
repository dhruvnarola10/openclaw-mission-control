"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { createPortal } from "react-dom";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [targetTheme, setTargetTheme] = useState<string | null>(null);

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-9 w-9" />;
  }

  const toggleTheme = () => {
    if (isTransitioning) return;
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTargetTheme(nextTheme);
    setIsTransitioning(true);
  };

  return (
    <>
      <button
        onClick={toggleTheme}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
        aria-label="Toggle theme"
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </button>

      {isTransitioning &&
        createPortal(
          <BlockTransition
            targetTheme={targetTheme!}
            onCoverComplete={() => {
              setTheme(targetTheme!);
            }}
            onComplete={() => {
              setIsTransitioning(false);
            }}
          />,
          document.body
        )}
    </>
  );
}

function BlockTransition({
  targetTheme,
  onCoverComplete,
  onComplete,
}: {
  targetTheme: string;
  onCoverComplete: () => void;
  onComplete: () => void;
}) {
  const [dimensions, setDimensions] = useState({ w: 0, h: 0 });
  const [phase, setPhase] = useState<"in" | "out">("in");

  const BLOCK_SIZE = 50; // 50px blocks

  useEffect(() => {
    setDimensions({
      w: window.innerWidth,
      h: window.innerHeight,
    });
  }, []);

  const cols = Math.ceil(dimensions.w / BLOCK_SIZE);
  const rows = Math.ceil(dimensions.h / BLOCK_SIZE);
  const totalBlocks = cols * rows;

  // Generate blocks
  const blocks = Array.from({ length: totalBlocks }).map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { id: i, col, row };
  });

  useEffect(() => {
    if (phase === "in" && totalBlocks > 0) {
      // Wait for blocks to cover screen
      const timer = setTimeout(() => {
        onCoverComplete();
        setPhase("out");
      }, 700); // adjust based on stagger duration
      return () => clearTimeout(timer);
    } else if (phase === "out" && totalBlocks > 0) {
      // Wait for blocks to clear screen
      const timer = setTimeout(() => {
        onComplete();
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [phase, totalBlocks, onCoverComplete, onComplete]);

  if (totalBlocks === 0) return null;

  const isGoingDark = targetTheme === "dark";

  return (
    <div
      className="fixed inset-0 z-[9999] pointer-events-none grid"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {blocks.map((b) => (
        <motion.div
          key={b.id}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{
            opacity: phase === "in" ? 1 : 0,
            scale: phase === "in" ? 1 : 0.8,
          }}
          transition={{
            duration: 0.3,
            delay: (b.col + b.row) * 0.02, // Diagonal wipe stagger
            ease: "easeInOut",
          }}
          className="w-full h-full"
          style={{
            backgroundColor: isGoingDark ? "#0f172a" : "#f8fafc", // slate-950 / slate-50
          }}
        />
      ))}
    </div>
  );
}
