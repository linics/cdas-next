import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChoiceGroup } from "./review-ui";

const options = [
  { value: "good", label: "良好" },
  { value: "pass", label: "合格" },
] as const;

describe("ChoiceGroup", () => {
  it("submits its value with the surrounding form by default", () => {
    const markup = renderToStaticMarkup(
      <form>
        <ChoiceGroup
          legend="下一步"
          name="nextStep"
          onChange={() => {}}
          options={options}
          value="good"
        />
      </form>,
    );

    expect(markup).toContain('name="nextStep"');
    expect(markup).not.toContain(" form=");
    expect(markup).toMatch(/checked="" [^>]*value="good"|value="good"[^>]*checked=""/u);
  });

  it("keeps detached radios out of a form whose server action accepts an exact field set", () => {
    const markup = renderToStaticMarkup(
      <form>
        <ChoiceGroup
          detached
          legend="1. 问题与机理"
          name="teacher-evaluation-dimension-1"
          onChange={() => {}}
          options={options}
          value=""
        />
      </form>,
    );

    // A form attribute naming no element disassociates the radio from the
    // enclosing form, so its value never reaches the prepare action.
    expect(markup.match(/form="teacher-evaluation-dimension-1-detached"/gu)).toHaveLength(
      options.length,
    );
  });
});
