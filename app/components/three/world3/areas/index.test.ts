import { describe, expect, it } from "vitest";
import { registeredAreaIds } from "../Areas";
import { AREAS } from "../Layout";
import "./index";

describe("areas/index (registry)", () => {
    it("registers a module for every area, so none gets an interim marker", () => {
        expect([...registeredAreaIds()].sort()).toEqual(AREAS.map((a) => a.id).sort());
    });
});
