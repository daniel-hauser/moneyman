---
name: patch israeli-bank-scrapers PR
about: A template for patching israeli-bank-scrapers pullrequests
title: patch israeli-bank-scrapers PR##
labels: ''
assignees: ''

---

This issue is to patch the israeli-bank-scrapers package to contain the changes of  https://github.com/eshaham/israeli-bank-scrapers/pull/###. Do not modify the patch file alone, you must use the patch-package package 

Steps:

- [ ] Pull the PR branch to a temp folder
- [ ] Install dependancies and build
- [ ] Copy the built files from the PR to the correct place in the node_modules folder
- [ ] run `npx patch-package israeli-bank-scrapers` to generate the patch
