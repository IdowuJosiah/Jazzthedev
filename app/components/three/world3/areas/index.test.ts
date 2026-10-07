import { describe, expect, it } from "vitest";
import { registeredAreaIds } from "../Areas";
import "./index";

describe("areas/index (Wave 2a registry)", () => {
    it("registers Welcome and Hub, so neither gets an interim marker", () => {
        expect(registeredAreaIds()).toEqual(expect.arrayContaining(["welcome", "hub"]));
    });
});
