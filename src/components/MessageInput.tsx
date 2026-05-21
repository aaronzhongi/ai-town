import clsx from 'clsx';
import { useMutation, useQuery } from 'convex/react';
import { KeyboardEvent, useRef, useState } from 'react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { useSendInput } from '../hooks/sendInput';
import { Player } from '../../convex/aiTown/player';
import { Conversation } from '../../convex/aiTown/conversation';

export function MessageInput({
  worldId,
  engineId,
  humanPlayer,
  conversation,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  humanPlayer: Player;
  conversation: Conversation;
}) {
  const descriptions = useQuery(api.world.gameDescriptions, { worldId });
  const humanName = descriptions?.playerDescriptions.find((p) => p.playerId === humanPlayer.id)
    ?.name;
  const inputRef = useRef<HTMLParagraphElement>(null);
  const inflightUuid = useRef<string | undefined>();
  // C003 — last `startTyping` call time. Initial 0 deliberately lets
  // the FIRST keystroke bypass the time-throttle (Date.now() - 0 ≫ 10s).
  const lastTypingPing = useRef<number>(0);
  const writeMessage = useMutation(api.messages.writeMessage);
  const startTyping = useSendInput(engineId, 'startTyping');
  const currentlyTyping = conversation.isTyping;

  const onKeyDown = async (e: KeyboardEvent) => {
    e.stopPropagation();

    // Set / refresh the typing indicator if we're not submitting.
    if (e.key !== 'Enter') {
      // C003 — KEEP the in-flight re-entrancy guard (prevents parallel
      // startTyping while a previous one is awaiting). REMOVED the
      // `currentlyTyping ||` short-circuit (was the bug — it refused
      // to refresh once any typing was registered, so the indicator
      // auto-cleared at TYPING_TIMEOUT and the agent could interject).
      if (inflightUuid.current !== undefined) {
        return;
      }
      // C003 — 10s time-throttle: re-call startTyping at most once per
      // 10s while user keeps typing. The startTyping handler is
      // idempotent on same-playerId (conversation.ts:296-301), so each
      // refresh just resets `isTyping.since = now`. With TYPING_TIMEOUT
      // 60s the throttle provides ~6 refreshes per minute — plenty.
      if (Date.now() - lastTypingPing.current < 10_000) {
        return;
      }
      inflightUuid.current = crypto.randomUUID();
      try {
        // Don't show a toast on error.
        await startTyping({
          playerId: humanPlayer.id,
          conversationId: conversation.id,
          messageUuid: inflightUuid.current,
        });
        lastTypingPing.current = Date.now();
      } finally {
        inflightUuid.current = undefined;
      }
      return;
    }

    // Send the current message.
    e.preventDefault();
    if (!inputRef.current) {
      return;
    }
    const text = inputRef.current.innerText;
    inputRef.current.innerText = '';
    if (!text) {
      return;
    }
    let messageUuid = inflightUuid.current;
    if (currentlyTyping && currentlyTyping.playerId === humanPlayer.id) {
      messageUuid = currentlyTyping.messageUuid;
    }
    messageUuid = messageUuid || crypto.randomUUID();
    await writeMessage({
      worldId,
      playerId: humanPlayer.id,
      conversationId: conversation.id,
      text,
      messageUuid,
    });
  };
  return (
    <div className="leading-tight mb-6">
      <div className="flex gap-4">
        <span className="uppercase flex-grow">{humanName}</span>
      </div>
      <div className={clsx('bubble', 'bubble-mine')}>
        <p
          className="bg-white -mx-3 -my-1"
          ref={inputRef}
          contentEditable
          style={{ outline: 'none' }}
          tabIndex={0}
          placeholder="Type here"
          onKeyDown={(e) => onKeyDown(e)}
        />
      </div>
    </div>
  );
}
