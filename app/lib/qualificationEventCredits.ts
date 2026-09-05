import type { QualificationBalloonClass, QualificationEvent } from "./pilotQualifications.ts";

export type BplEventCredit = Readonly<{
  requirement: "TRAINING_FLIGHT" | "PROFICIENCY_CHECK";
  dateIso: string;
  sourceEventIds: readonly string[];
  creditedFrom: QualificationEvent["type"];
  balloonClass?: QualificationBalloonClass;
}>;

function sameKnownClass(left: QualificationEvent, right: QualificationEvent): boolean {
  if (!left.balloonClass?.classId || left.balloonClass.classId !== right.balloonClass?.classId) return false;
  return left.balloonClass.classId !== "HOT_AIR_BALLOON" || !left.balloonClass.groupId || !right.balloonClass?.groupId || left.balloonClass.groupId === right.balloonClass.groupId;
}

/** Calcule des crédits sans retyper ni dupliquer les événements sources. */
export function bplEventCredits(events: readonly QualificationEvent[]): readonly BplEventCredit[] {
  const activeEvents = events.filter((event) => !event.officialAscensionDeletedAt);
  const byId = new Map(activeEvents.map((event) => [event.id, event]));
  return activeEvents.flatMap((event): BplEventCredit[] => {
    if (event.type === "TRAINING_FLIGHT_BPL" && event.instructor?.name.trim()) {
      return [{ requirement: "TRAINING_FLIGHT", dateIso: event.dateIso, sourceEventIds: [event.id], creditedFrom: event.type, ...(event.balloonClass ? { balloonClass: event.balloonClass } : {}) }];
    }
    if (event.type === "PROFICIENCY_CHECK_BPL" && event.examiner?.name.trim()) {
      return [{ requirement: "PROFICIENCY_CHECK", dateIso: event.dateIso, sourceEventIds: [event.id], creditedFrom: event.type, ...(event.balloonClass ? { balloonClass: event.balloonClass } : {}) }];
    }
    if (event.type === "COMMERCIAL_PROFICIENCY_CHECK" && event.examiner?.name.trim() && event.balloonClass?.classId) {
      return [{ requirement: "PROFICIENCY_CHECK", dateIso: event.dateIso, sourceEventIds: [event.id], creditedFrom: event.type, balloonClass: event.balloonClass }];
    }
    if (event.type !== "COMMERCIAL_REFRESHER_COURSE" || (event.theoryMinutes ?? 0) < 360 || !event.balloonClass?.classId) return [];
    const training = event.relatedEventIds
      ?.map((id) => byId.get(id))
      .find((candidate) => candidate?.type === "TRAINING_FLIGHT_BPL" && candidate.instructor?.name.trim() && sameKnownClass(event, candidate));
    const provenBalloonClass = event.balloonClass.classId === "HOT_AIR_BALLOON" && event.balloonClass.groupId && event.balloonClass.groupId === training?.balloonClass?.groupId
      ? event.balloonClass
      : { classId: event.balloonClass.classId };
    return training
      ? [{ requirement: "TRAINING_FLIGHT", dateIso: event.dateIso, sourceEventIds: [event.id, training.id], creditedFrom: event.type, balloonClass: provenBalloonClass }]
      : [];
  });
}
