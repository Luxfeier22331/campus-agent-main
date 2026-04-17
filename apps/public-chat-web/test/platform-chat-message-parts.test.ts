import { describe, expect, it } from "vitest";

import { mapShellMessageToChatMessage } from "../src/platform/chat/message-parts";

describe("platform chat message parts", () => {
  it("adds a data-place-card part after the assistant text part", () => {
    expect(
      mapShellMessageToChatMessage({
        createdAt: "2026-04-11T09:00:02.000Z",
        id: "msg_assistant",
        kind: "answer",
        requestId: "req_123",
        retryable: false,
        role: "assistant",
        structuredParts: [
          {
            placeCard: {
              campusScope: "海淀校区",
              campusArea: "主教学区西侧",
              coordinateReferenceSystem: "WGS84",
              displayName: "图书馆",
              entityType: "building",
              landmarkHint: "靠近校医院与主干道交叉口",
              locationDescription: "海淀校区主教学区西侧，靠近校医院。",
              pointGeometry: {
                coordinates: [116.31551, 39.96162],
                type: "Point",
              },
              placeId: "muc.haidian.library",
              serviceTags: ["自习", "借阅"],
              sourceRefs: ["campus_navigation/place_catalog/seed.v1.json#library"],
            },
            type: "place_card",
          },
        ],
        text: "图书馆在海淀校区主教学区西侧，靠近校医院。",
      }).parts,
    ).toEqual([
      {
        text: "图书馆在海淀校区主教学区西侧，靠近校医院。",
        type: "text",
      },
      {
        data: {
          campusScope: "海淀校区",
          campusArea: "主教学区西侧",
          coordinateReferenceSystem: "WGS84",
          displayName: "图书馆",
          entityType: "building",
          landmarkHint: "靠近校医院与主干道交叉口",
          locationDescription: "海淀校区主教学区西侧，靠近校医院。",
          pointGeometry: {
            coordinates: [116.31551, 39.96162],
            type: "Point",
          },
          placeId: "muc.haidian.library",
          serviceTags: ["自习", "借阅"],
          sourceRefs: ["campus_navigation/place_catalog/seed.v1.json#library"],
        },
        type: "data-place-card",
      },
    ]);
  });

  it("still emits a place card when assistant text is empty", () => {
    expect(
      mapShellMessageToChatMessage({
        createdAt: "2026-04-11T09:00:02.000Z",
        id: "msg_assistant",
        kind: "answer",
        requestId: "req_456",
        retryable: false,
        role: "assistant",
        structuredParts: [
          {
            placeCard: {
              displayName: "教务处",
              entityType: "office",
              locationDescription: "综合办公楼二层东侧服务大厅。",
              placeId: "muc.haidian.registry-office",
            },
            type: "place_card",
          },
        ],
        text: "   ",
      }).parts,
    ).toEqual([
      {
        data: {
          displayName: "教务处",
          entityType: "office",
          locationDescription: "综合办公楼二层东侧服务大厅。",
          placeId: "muc.haidian.registry-office",
        },
        type: "data-place-card",
      },
    ]);
  });
});
