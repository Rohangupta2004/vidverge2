import { useEffect, useMemo } from 'react';
import type { RefObject } from 'react';
import {
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'framer-motion';

const MICRO_SPRING = { stiffness: 200, damping: 25, mass: 0.7 };
const MAX_TILT = 12;

type MotionStyle = {
  transformStyle: 'preserve-3d';
  perspective: string;
  boxShadow: ReturnType<typeof useMotionTemplate>;
};

export function useCardTilt<T extends HTMLElement>(ref: RefObject<T | null>) {
  const prefersReducedMotion = useReducedMotion();
  const rotateXTarget = useMotionValue(0);
  const rotateYTarget = useMotionValue(0);
  const shadowXTarget = useMotionValue(0);
  const shadowYTarget = useMotionValue(18);

  const rotateX = useSpring(rotateXTarget, MICRO_SPRING);
  const rotateY = useSpring(rotateYTarget, MICRO_SPRING);
  const shadowX = useSpring(shadowXTarget, MICRO_SPRING);
  const shadowY = useSpring(shadowYTarget, MICRO_SPRING);

  const transform = useMotionTemplate`perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(0)`;
  const boxShadow = useMotionTemplate`${shadowX}px ${shadowY}px 48px rgba(0, 0, 0, 0.42), ${shadowX}px ${shadowY}px 70px rgba(124, 58, 237, 0.12)`;

  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion) return;

    const coarsePointer = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    if (coarsePointer) return;

    const handlePointerMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const offsetX = event.clientX - (rect.left + rect.width / 2);
      const offsetY = event.clientY - (rect.top + rect.height / 2);
      const nextRotateX = Math.max(-MAX_TILT, Math.min(MAX_TILT, offsetY * -0.08));
      const nextRotateY = Math.max(-MAX_TILT, Math.min(MAX_TILT, offsetX * 0.08));

      rotateXTarget.set(nextRotateX);
      rotateYTarget.set(nextRotateY);
      shadowXTarget.set(nextRotateY * -1.25);
      shadowYTarget.set(18 + Math.abs(nextRotateX) * 0.7);
      node.style.setProperty('--tilt-gloss-x', `${((offsetX / rect.width) + 0.5) * 100}%`);
      node.dataset.tilting = 'true';
    };

    const resetTilt = () => {
      rotateXTarget.set(0);
      rotateYTarget.set(0);
      shadowXTarget.set(0);
      shadowYTarget.set(18);
      delete node.dataset.tilting;
    };

    node.addEventListener('pointermove', handlePointerMove);
    node.addEventListener('pointerleave', resetTilt);
    return () => {
      node.removeEventListener('pointermove', handlePointerMove);
      node.removeEventListener('pointerleave', resetTilt);
    };
  }, [prefersReducedMotion, ref, rotateXTarget, rotateYTarget, shadowXTarget, shadowYTarget]);

  const style = useMemo<MotionStyle>(() => ({
    transformStyle: 'preserve-3d',
    perspective: '1000px',
    boxShadow,
  }), [boxShadow]);

  return { transform, style };
}
