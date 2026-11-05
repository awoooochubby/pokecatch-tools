// T = E[attempt moves] + (1 - p)T. Both sides and losing runs count.
export function expectedClearMoves(meanAttemptMoves: number, winRate: number): number | null {
  return winRate > 0 && Number.isFinite(meanAttemptMoves) ? meanAttemptMoves / winRate : null;
}
export const clearTimeScore = (report: { expectedClearMoves: number | null }) => report.expectedClearMoves ?? Infinity;
export function formatRaidMoves(moves: number | null | undefined) {
  return moves == null || !Number.isFinite(moves) ? '暂无成功样本' : `${moves.toFixed(1)} 次出招`;
}
