# Advanced Multi Column — Usage Examples

Copy any example below into an Obsidian note to see it in action.
For legacy callout syntax (`[!col]` / `[!col-md-*]`), see [legacy-usage.md](./legacy-usage.md).

---

## 1. Simple Two-Column

A basic left/right split.


%% col-start %%
%% col-break %%
### About Me
I'm a software developer passionate about open-source tools and knowledge management.
%% col-break %%
### Contact
- GitHub: @username
- Twitter: @handle
- Email: hello@example.com
%% col-end %%


---

## 2. Three Equal Columns

Three columns with equal width for comparison layouts.


%% col-start %%
%% col-break %%
### Plan A
- 5 GB storage
- 1 user
- Email support
- **$9/month**
%% col-break %%
### Plan B
- 50 GB storage
- 5 users
- Priority support
- **$29/month**
%% col-break %%
### Plan C
- Unlimited storage
- Unlimited users
- 24/7 support
- **$99/month**
%% col-end %%


---

## 3. Asymmetric Sidebar (70/30)

A wide main content area with a narrow sidebar.


%% col-start %%
%% col-break:70 %%
## Project Overview

This project aims to build a cross-platform note-taking application with real-time collaboration features. The architecture follows a modular design pattern with clear separation of concerns.

Key decisions:
1. Use markdown as the primary format
2. Implement CRDT for real-time sync
3. Support offline-first operation

> "The best tool is the one that gets out of your way." — Unknown
%% col-break:30 %%
### Quick Links
- [[Architecture]]
- [[API Reference]]
- [[Changelog]]
- [[Contributing]]

### Status
**Phase:** Beta
**Version:** 0.8.2
**Last updated:** 2025-01-15
%% col-end %%


---

## 4. Four-Column Dashboard

Four narrow columns for a dashboard overview.


%% col-start %%
%% col-break %%
### Inbox
- [ ] Review PR #42
- [ ] Reply to Sarah
- [ ] Read RFC draft
%% col-break %%
### Today
- [ ] Ship v1.0 release
- [ ] Update docs
- [x] Fix scroll bug
%% col-break %%
### This Week
- [ ] Write blog post
- [ ] Plan sprint 12
- [ ] Team retrospective
%% col-break %%
### Done
- [x] Merge feature branch
- [x] Deploy staging
- [x] QA sign-off
%% col-end %%


---

## 5. Nested Columns

A parent column containing its own child columns.


%% col-start %%
%% col-break:40 %%
## Navigation

- [[Home]]
- [[Projects]]
- [[Archive]]
- [[Settings]]

This sidebar stays fixed while the right side has its own sub-layout.
%% col-break:60 %%
## Content Area

This column contains a nested two-column layout below:

%% col-start %%
%% col-break %%
### Recent Notes
1. Meeting notes — Jan 20
2. Research log — Jan 18
3. Book review — Jan 15
%% col-break %%
### Pinned
1. [[Yearly Goals]]
2. [[Reading List]]
3. [[Workout Plan]]
%% col-end %%
%% col-end %%


---

## 6. Styled Columns

Using inline style tokens for color and borders.


%% col-start:b:secondary,sb:1,bc:accent %%
%% col-break:50,b:blue-soft,bc:blue,t:text,sb:1 %%
### Blue Section
This column has a blue tint background with a blue border. Useful for highlighting informational content.

- Tip 1: Use color to group related items
- Tip 2: Keep it subtle — tints work best
%% col-break:50,b:green-soft,bc:green,t:text,sb:1 %%
### Green Section
This column has a green tint background with a green border. Great for success states or positive notes.

- Result: Tests passing
- Status: All clear
- Next: Deploy to production
%% col-end %%


---

## 7. Mixed Content Types

Headings, paragraphs, lists, blockquotes, and code in columns.

`
%% col-start %%
%% col-break %%
## Writing

Markdown is a lightweight markup language. Here's a sample:

> "Writing is thinking. To write well is to think clearly."
> — William Zinsser

Key principles:
1. Clarity over cleverness
2. Short paragraphs
3. Active voice
%% col-break %%
## Code

A quick sorting example:

python
def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[0]
    left = [x for x in arr[1:] if x < pivot]
    right = [x for x in arr[1:] if x >= pivot]
    return quicksort(left) + [pivot] + quicksort(right)


**Time complexity:** O(n log n) average
%% col-break %%
## Reference

| Symbol | Meaning     |
| ------ | ----------- |
| O(1)   | Constant    |
| O(n)   | Linear      |
| O(n²)  | Quadratic   |
| O(2ⁿ)  | Exponential |

---

See also: [[Algorithms]], [[Data Structures]]
%% col-end %%
`

---

## 8. Complex Dashboard with Nested + Styles

A three-column layout with one column containing a styled nested block.


%% col-start:b:primary,sb:1,bc:gray %%
%% col-break:25,b:alt %%
### Metrics
**Users:** 12,847
**Revenue:** $48.2k
**Churn:** 2.1%
**NPS:** 72

---

Last 30 days
%% col-break:50 %%
### Activity Feed

Latest updates from across the team:

%% col-start:b:secondary,sb:1,bc:muted %%
%% col-break %%
**Engineering**
- Shipped v2.3.1
- Fixed 14 bugs
- 3 PRs in review
%% col-break %%
**Design**
- New onboarding flow
- Icon refresh done
- A/B test results in
%% col-end %%

Overall progress: 78% of Q1 goals complete.
%% col-break:25,b:alt %%
### Quick Actions
- [ ] Review analytics
- [ ] Approve budget
- [ ] Schedule 1:1s
- [ ] Update roadmap

---

**Next milestone:** Feb 28
%% col-end %%


---

## 9. Kanban-Style Task Board

Four styled columns mimicking a kanban board.


%% col-start:sb:1,bc:muted %%
%% col-break:25,b:alt,sb:1,bc:gray %%
### Backlog
- [ ] User authentication
- [ ] Dark mode toggle
- [ ] Export to PDF
- [ ] Notification system
- [ ] Search improvements
%% col-break:25,b:cyan-soft,sb:1,bc:cyan %%
### In Progress
- [ ] Dashboard redesign
- [ ] API rate limiting
- [ ] Mobile responsive fix
%% col-break:25,b:yellow-soft,sb:1,bc:yellow %%
### Review
- [ ] Payment integration
- [ ] Email templates
%% col-break:25,b:green-soft,sb:1,bc:green %%
### Done
- [x] User registration
- [x] Database migration
- [x] CI/CD pipeline
- [x] Landing page
- [x] SSL setup
%% col-end %%


---

## 10. Notes + Callout Sidebar (Simple)

A basic content + sidebar layout where the sidebar is a callout.


%% col-start %%
%% col-break:70 %%
## Weekly reflection

This week I focused on improving review quality and reducing context switching.

Wins:
- Closed 5 long-running tasks
- Reduced bug count in backlog
- Wrote release documentation

Next week focus:
- Stabilize drag-and-drop interactions
- Add more usage examples
%% col-break:30 %%
> [!tip] Quick recap
> - **Energy:** High
> - **Bottleneck:** Meetings
> - **Priority:** Finish docs
> - **Risk:** Overcommitting
%% col-end %%


---

## 11. Side-by-Side Comparison Tables

Two tables in parallel for easy before/after review.


%% col-start %%
%% col-break:50 %%
### Current process

| Step | Owner | Avg time |
| ---- | ----- | -------- |
| Triage | Support | 2h |
| Reproduce | QA | 6h |
| Fix | Engineering | 1.5d |
| Verify | QA | 4h |

%% col-break:50 %%
### Proposed process

| Step | Owner | Avg time |
| ---- | ----- | -------- |
| Triage + classify | Support | 1h |
| Reproduce + logs | QA | 3h |
| Fix + tests | Engineering | 1d |
| Verify + release note | QA | 2h |

%% col-end %%


---

## 12. Three-Column Study Board

Simple three-column board for a learning session.


%% col-start %%
%% col-break %%
### Read
- [[Distributed systems notes]]
- [[CAP theorem]]
- [[Raft paper summary]]
%% col-break %%
### Practice
- Implement leader election
- Simulate node failure
- Write 3 test cases
%% col-break %%
### Capture
> [!note] Key takeaway
> Consistency and availability trade off under partition.

- Add notes to [[Knowledge Base]]
- Create follow-up questions
%% col-end %%


---

## 13. Incident Response Panel (Callouts + Nested)

Operations layout with nested status cards.


%% col-start %%
%% col-break:25 %%
### Commander
- [ ] Confirm severity
- [ ] Assign owners
- [ ] Open timeline
- [ ] Post status update

> [!warning] Rule
> Keep timeline updates every 15 minutes.
%% col-break:50 %%
### Live status

%% col-start:sb:1,bc:muted,b:secondary %%
%% col-break:b:red-soft,bc:red,sb:1 %%
> [!failure] API
> Error rate: **8.2%**
> Owner: Backend
%% col-break:b:yellow-soft,bc:yellow,sb:1 %%
> [!warning] Queue
> Lag: **4m 12s**
> Owner: Platform
%% col-break:b:green-soft,bc:green,sb:1 %%
> [!success] Web
> Healthy
> Owner: Frontend
%% col-end %%

### Timeline
- 10:02 - Alert fired
- 10:07 - Incident declared
- 10:18 - Mitigation deployed
%% col-break:25 %%
### Runbooks
- [[Rollback procedure]]
- [[Traffic shaping]]
- [[Database failover]]

| Channel | Link |
| ------- | ---- |
| Slack | #incident-sev2 |
| Zoom | bridge-ops |
%% col-end %%


---

## 14. Product Roadmap (Tables + Nested Quarters)

Roadmap summary with nested quarter plan.


%% col-start %%
%% col-break:40 %%
### Theme goals

| Theme | Objective | KPI |
| ----- | --------- | --- |
| Reliability | Fewer regressions | -40% P1 bugs |
| Onboarding | Faster first value | +25% activation |
| Performance | Quicker load times | <1.5s FCP |

%% col-break:60 %%
### Quarter plan

%% col-start:b:secondary,sb:1,bc:gray %%
%% col-break:33 %%
#### Q1
- Auth cleanup
- Onboarding revamp
- Search indexing
%% col-break:33 %%
#### Q2
- Mobile polish
- Sync conflict tools
- API hardening
%% col-break:34 %%
#### Q3
- Enterprise SSO
- Audit logs
- Usage analytics
%% col-end %%
%% col-end %%


---

## 15. Knowledge Hub (Nested + Callouts + Table)

A knowledge landing page with nested cards.


%% col-start %%
%% col-break:30 %%
### Navigation
- [[Playbooks]]
- [[Architecture]]
- [[Decision records]]
- [[Postmortems]]
%% col-break:70 %%
## Highlights

%% col-start %%
%% col-break:60 %%
> [!abstract] New this week
> - Added deployment checklist v3
> - Updated onboarding flow diagram
> - Added pager duty handoff template
%% col-break:40 %%
| Doc | Owner |
| --- | ----- |
| Deploy checklist | DevOps |
| Incident template | SRE |
| API style guide | Platform |
%% col-end %%

### Notes
Keep this page lightweight. Link out to deep docs from each card.
%% col-end %%


---

## 16. Personal Finance Snapshot (Styled + Tables)

Monthly overview with styled budget blocks.


%% col-start:sb:1,bc:gray,b:primary %%
%% col-break:35,b:blue-soft,bc:blue,sb:1 %%
### Income

| Source | Amount |
| ------ | ------ |
| Salary | $5,800 |
| Freelance | $1,200 |
| Other | $150 |

**Total:** $7,150
%% col-break:35,b:orange-soft,bc:orange,sb:1 %%
### Expenses

| Category | Amount |
| -------- | ------ |
| Rent | $1,900 |
| Food | $620 |
| Transport | $180 |
| Utilities | $240 |

**Total:** $2,940
%% col-break:30,b:green-soft,bc:green,sb:1 %%
### Outcome
> [!success] Net
> $4,210 remaining

Planned allocation:
- 60% savings
- 20% investments
- 20% fun
%% col-end %%


---

## 17. Project Workspace (Nested Board + Action Rail)

A project page with a nested board and right-side action rail.


%% col-start %%
%% col-break:20 %%
### Context
- [[Scope]]
- [[Stakeholders]]
- [[Risks]]
- [[Timeline]]
%% col-break:60 %%
### Work board

%% col-start %%
%% col-break %%
#### Doing
- Implement drag target rules
- Write usage examples
%% col-break %%
#### Blocked
- Waiting on API key
- Pending design review
%% col-break %%
#### Next
- Add keyboard shortcut docs
- Add migration notes
%% col-end %%
%% col-break:20 %%
### Actions
> [!todo] Today
> - [ ] Review open bugs
> - [ ] Update release note
> - [ ] Check mobile layout
%% col-end %%


---

## 18. Multi-Level Operating Review (Advanced)

A deeper nested layout for executive weekly review.


%% col-start:sb:1,bc:muted %%
%% col-break:25,b:alt %%
### Leadership notes
- Objectives for week 8
- Key risks
- Escalations

> [!warning] Watch item
> Churn trend rising in SMB segment.
%% col-break:75 %%
### Weekly operating review

%% col-start:b:secondary,sb:1,bc:gray %%
%% col-break:50 %%
#### Delivery

| Team | Planned | Done | Delta |
| ---- | ------- | ---- | ----- |
| Platform | 12 | 11 | -1 |
| Product | 9 | 9 | 0 |
| Growth | 7 | 8 | +1 |

%% col-start %%
%% col-break %%
##### Risks
- API latency
- Hiring delay
%% col-break %%
##### Mitigation
- Cache hot paths
- Use contractor support
%% col-end %%
%% col-break:50 %%
#### Business

| Metric | Last week | This week |
| ------ | --------- | --------- |
| Revenue | $92k | $95k |
| Churn | 2.4% | 2.8% |
| NPS | 66 | 68 |

> [!info] Commentary
> Revenue improved despite churn increase.
> Investigate churn by segment before next review.
%% col-end %%
%% col-end %%
