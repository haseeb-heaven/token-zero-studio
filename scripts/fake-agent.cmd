@echo off
rem Fake agent used by the e2e launch test: proves env injection + spawn works,
rem then exits immediately so no orphaned processes are left behind.
echo FAKE-AGENT OPENAI_BASE_URL=%OPENAI_BASE_URL% ANTHROPIC_BASE_URL=%ANTHROPIC_BASE_URL%
