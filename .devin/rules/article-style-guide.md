---
trigger: model_decision
description: when writing paper
---

# Academic Paper Writing Style Guide

Target journal: Food Control (Elsevier). Follow the style of published Food Control papers.

---

## 1. Sentence Structure

- Use short declarative sentences as the default unit. State the result first, then give the reason in a separate sentence.
- Vary sentence length naturally. One short sentence followed by a longer explanatory one is fine; avoid chains of uniformly long sentences.
- Do not front-load sentences with long dependent clauses. Bad: "To address the issue of ... which is caused by ..., the method was ...". Good: "The method addresses this issue by ...".

## 2. Avoid AI-Sounding Patterns

- **No em dashes as inline explanation markers.** Do not write `... sensor array — an 8-channel MOS device — was ...`. Instead split into two sentences or rewrite as a relative clause.
- **No parenthetical enumeration lists.** Do not write `(i) ...; (ii) ...; (iii) ...` inside running prose. If enumeration is needed, use a numbered list or integrate each point as its own sentence.
- **No "First... Second... Third..." numbered paragraph openers** unless presenting a formal algorithm or procedure.
- **No formulaic connector phrases** such as "This is a direct consequence of", "This motivates the following", "Taken together, these results demonstrate". Replace with simpler alternatives: "This reflects", "This is consistent with", "These results show".
- **No nested parentheses** with multiple asides inside a single sentence.

## 3. Reporting Results

- Cite the figure or table immediately after stating the result: "Classification results are summarised in Table 1." or "Fig. 3 shows the NLDI heatmap."
- Report numbers directly inline without repeating the unit in parentheses: "PC1 accounts for 56.6% and PC2 for 9.1%" not "PC1 (56.6%) and PC2 (9.1%)".
- When comparing two values, use "while", "compared with", or "whereas" rather than a dash or colon.
- State the best result with a brief explanation: "CARL achieves 91.2% accuracy. This gain is not attributable to model scale, since all deep learning models operate at comparable parameter counts."

## 4. Explanatory / Discussion Text

- Explain *why* a result occurs in a separate sentence after the result sentence. Keep the explanation brief and tied to a specific mechanism (adsorption chemistry, drift, etc.).
- When citing literature to support a claim, embed the citation naturally: "This is consistent with masking effects reported in sensory studies of binary aroma mixtures (Niu et al., 2022)."
- Avoid ending a section with a forward-looking meta-comment like "This motivates Section X." End with the substantive conclusion of the section itself.

## 5. Hedging and Precision

- Use "may", "suggests", "is consistent with" when the mechanism is inferred rather than directly measured.
- Do not claim certainty for mechanistic explanations that rely on literature analogy. Use "attributable to", "likely reflects", "is consistent with".
- Negative R² values should be explicitly interpreted: state that the model performs below a trivial mean predictor.

## 6. Tables and Figures

- Table captions describe the content and evaluation protocol in one or two sentences. Include sample size (n) and CV scheme.
- Bold the best value per metric column in results tables.
- Use ↑/↓ arrows in column headers to indicate direction of improvement.
- Figure captions describe what each panel shows; do not interpret results in the caption.

## 7. What to Avoid

- Overuse of "Furthermore", "Moreover", "Additionally" — use once per paragraph at most.
- "It is worth noting that" and "It should be mentioned that" — delete and state the point directly.
- "In order to" — replace with "To".
- Passive constructions that hide the subject unnecessarily: prefer "The encoder maps X to Y" over "X is mapped to Y by the encoder" when the subject is clear.
