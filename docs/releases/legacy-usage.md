# Advanced Multi Column — Legacy Callout Usage

Use these examples if your notes still use legacy callout syntax.

- Parent container: `> [!col]`
- Child columns: `> > [!col-md]` or `> > [!col-md-<span>]`
- Supported custom spans: `0.5` to `10` (step `0.5`)
- Keep child columns as sibling nested callouts under the same parent callout.

If you see literal text like `[!col-md]` in preview, the nested callout structure is invalid.
Use the exact sibling pattern shown below (`> > [!col-md]` blocks under one `> [!col]` parent).

Marker syntax (`%% col-start %%`) is recommended for new notes, but legacy callouts remain supported.

---

## 1. Simple Two-Column

> [!col]
> > [!col-md]
> > ### About
> > - Product engineer
> > - Writes plugin docs
>
> > [!col-md]
> > ### Contact
> > - GitHub: @username
> > - Email: hello@example.com

---

## 2. Three Equal Columns

> [!col]
> > [!col-md]
> > ### Plan A
> > - 5 GB
> > - 1 user
>
> > [!col-md]
> > ### Plan B
> > - 50 GB
> > - 5 users
>
> > [!col-md]
> > ### Plan C
> > - Unlimited
> > - Unlimited users

---

## 3. 2:1 Sidebar Layout

> [!col]
> > [!col-md-2]
> > ## Main content
> > Build notes, changelog, and deep technical context live here.
>
> > [!col-md-1]
> > ### Sidebar
> > - [[Roadmap]]
> > - [[Open Issues]]
> > - [[Release Notes]]

---

## 4. Weighted Columns (3 : 1.5 : 1)

> [!col]
> > [!col-md-3]
> > ### Primary
> > Feature specs and decisions.
>
> > [!col-md-1.5]
> > ### Secondary
> > Risks and mitigations.
>
> > [!col-md-1]
> > ### Tertiary
> > Quick links and owners.

---

## 5. Side-by-Side Tables

> [!col]
> > [!col-md]
> > ### Current process
> > | Step | Owner | Avg time |
> > | ---- | ----- | -------- |
> > | Triage | Support | 2h |
> > | Reproduce | QA | 6h |
> > | Fix | Engineering | 1.5d |
>
> > [!col-md]
> > ### Proposed process
> > | Step | Owner | Avg time |
> > | ---- | ----- | -------- |
> > | Triage + classify | Support | 1h |
> > | Reproduce + logs | QA | 3h |
> > | Fix + tests | Engineering | 1d |

---

## 6. Callouts Inside Legacy Columns

> [!col]
> > [!col-md]
> > ### Health
> > > [!success] Green
> > > Error rate below threshold.
>
> > [!col-md]
> > ### Attention
> > > [!warning] Watch item
> > > Queue latency is rising this week.

---

## 7. Nested Legacy Columns

> [!col]
> > [!col-md-2]
> > ## Main area
> >
> > > [!col]
> > > > [!col-md]
> > > > #### Left nested
> > > > Checklist and links.
> > >
> > > > [!col-md]
> > > > #### Right nested
> > > > Notes and backlog.
>
> > [!col-md-1]
> > ## Side rail
> > - [[Today]]
> > - [[This week]]
> > - [[Next week]]

---

## 8. Kanban-Like Board

> [!col]
> > [!col-md]
> > ### Backlog
> > - [ ] Design API contract
> > - [ ] Draft migration notes
>
> > [!col-md]
> > ### Doing
> > - [ ] Implement drag rules
> > - [ ] Add unit tests
>
> > [!col-md]
> > ### Done
> > - [x] Fix table rendering
> > - [x] Improve docs

---

## 9. Mixed Content (Media + Notes)

> [!col]
> > [!col-md-1.5]
> > ### Media
> > ![[example-image.png]]
> > ![[demo-video.mp4]]
>
> > [!col-md-2.5]
> > ### Notes
> > - Supports wikilinks and embeds
> > - Works with tasks, callouts, and tables
> > - Useful for dashboards and study boards
