import { compilePattern, matchPattern } from "./wildcard.js";

it.each([
  ["literal * ? ~ [.*]", "~* ~? ~~"],
  ["A😀B aXb", "a?b"],
  ["<script>& .+ (test)", ".+ (TEST)"],
])("matches bounded literal/wildcard spans in %s", (text, query) => {
  expect(matchPattern(text, compilePattern(query))).toMatchSnapshot();
});

it("collapses repeated stars and handles adversarial nonmatching patterns without backtracking", () => {
  expect(compilePattern("*".repeat(1000))).toHaveLength(1);
  expect(
    matchPattern("a".repeat(2000), compilePattern(`${"*a".repeat(80)}*z`)),
  ).toMatchSnapshot();
});
